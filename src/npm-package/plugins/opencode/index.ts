import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { exec, execSync, spawn } from "node:child_process"
import { promisify } from "node:util"
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const execAsync = promisify(exec)

interface OpenCodePluginInput {
  directory: string
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): Promise<string> }>
}

// ── Constants ──

const CACHE_TTL_MS = 86_400_000 // 24h
const FETCH_TIMEOUT_MS = 5_000

const XP_GATE_NPM_PKG = "@boyingliu01/xp-gate"
const XP_GATE_CACHE_FILE = join(homedir(), ".xp-gate", "xp-gate-version-check.json")
const XP_GATE_REGISTRY_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(XP_GATE_NPM_PKG)}/dist-tags`

const OPENCODE_PLUGIN_REGISTRY = "https://registry.npmjs.org/-/package/@boyingliu01%2Fopencode-plugin/dist-tags"
const OPENCODE_CACHE_FILE = join(homedir(), ".xp-gate", "opencode-plugin-version-check.json")

let checked = false

// ── Utilities ──

function semverLt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na < nb
  }
  return false
}

async function fetchNpmLatestVersion(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const data: Record<string, unknown> = await response.json()
    return typeof data.latest === "string" ? data.latest : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function readCache(file: string): { ts: number; remoteVersion: string; localVersion?: string; status?: string } | null {
  try {
    if (!existsSync(file)) return null
    const raw = readFileSync(file, "utf8")
    const data = JSON.parse(raw)
    if (Date.now() - data.ts < CACHE_TTL_MS && data.remoteVersion) return data
    return null
  } catch {
    return null
  }
}

function writeCache(file: string, data: object): void {
  try {
    mkdirSync(join(homedir(), ".xp-gate"), { recursive: true })
    writeFileSync(file + ".tmp", JSON.stringify(data), "utf8")
    try { rmSync(file) } catch {}
    writeFileSync(file, readFileSync(file + ".tmp", "utf8"), "utf8")
    try { rmSync(file + ".tmp") } catch {}
  } catch {
    // silent
  }
}

// ── XP-Gate npm package auto-update ──

type UpgradeResult = {
  action: "noop" | "upgraded" | "error"
  localVersion: string | null
  remoteVersion: string | null
  error?: string
}

function getLocalXpGateVersion(): string | null {
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim()
    const pkg = JSON.parse(readFileSync(join(globalRoot, XP_GATE_NPM_PKG, "package.json"), "utf8"))
    return pkg.version || null
  } catch {
    return null
  }
}

async function checkXpGateUpdate(): Promise<UpgradeResult> {
  const cached = readCache(XP_GATE_CACHE_FILE)
  const localVersion = getLocalXpGateVersion()

  // If cache exists and local version hasn't changed AND status is "current",
  // the cache is still valid — skip network check
  if (cached?.status === "current" && cached.remoteVersion && localVersion && cached.localVersion === localVersion) {
    return { action: "noop", localVersion, remoteVersion: cached.remoteVersion }
  }

  // If we have a valid cache but local version changed (e.g., manual upgrade)
  // or cache has no "current" status, we need to re-check remote
  if (!localVersion) return { action: "noop", localVersion: null, remoteVersion: null }

  const remoteVersion = await fetchNpmLatestVersion(XP_GATE_REGISTRY_URL)
  if (!remoteVersion) return { action: "noop", localVersion, remoteVersion: null }

  if (!semverLt(localVersion, remoteVersion)) {
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { action: "noop", localVersion, remoteVersion }
  }

  // Check opt-out config
  const config = readXpGateConfig()
  if (config?.autoUpgrade === false) {
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { action: "noop", localVersion, remoteVersion }
  }

  writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion })
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn("npm", ["install", "-g", `${XP_GATE_NPM_PKG}@${remoteVersion}`], {
        stdio: "pipe",
        shell: true,  // Required on Windows: npm is a .cmd file
        timeout: 120_000,
      })
      child.on("close", (code) => resolve(code))
      child.on("error", (err) => reject(err))
    })
    if (exitCode === 0) {
      writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion: remoteVersion, remoteVersion, status: "current" })
      return { action: "upgraded", localVersion, remoteVersion }
    }
    return { action: "error", localVersion, remoteVersion, error: `npm install exited with code ${exitCode}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { action: "error", localVersion, remoteVersion, error: msg }
  }
}

function readXpGateConfig(): { autoUpgrade?: boolean } | null {
  const cfgPath = join(homedir(), ".xp-gate", "config.json")
  try {
    if (!existsSync(cfgPath)) return null
    return JSON.parse(readFileSync(cfgPath, "utf8"))
  } catch {
    return null
  }
}
// ── OpenCode plugin version check (notification only) ──

async function checkPluginUpdate(pluginDir: string): Promise<void> {
  const cached = readCache(OPENCODE_CACHE_FILE)
  if (cached?.status === "current" && cached.remoteVersion) return

  let localVersion = ""
  try {
    const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"))
    localVersion = pkg.version || ""
  } catch {
    return
  }

  const remoteVersion = await fetchNpmLatestVersion(OPENCODE_PLUGIN_REGISTRY)
  if (!remoteVersion) return

  if (remoteVersion && localVersion && semverLt(localVersion, remoteVersion)) {
    writeCache(OPENCODE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion })
  } else if (remoteVersion && localVersion) {
    writeCache(OPENCODE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
  }
}

// ── TUI upgrade notice ──

const UPGRADE_NOTICE_FILE = join(homedir(), ".xp-gate", "upgrade-notice.json")

type UpgradeNotice = {
  kind: "upgraded" | "outdated" | "error"
  localVersion: string | null
  remoteVersion: string | null
  message: string
  ts: number
}

function writeUpgradeNotice(notice: UpgradeNotice): void {
  writeCache(UPGRADE_NOTICE_FILE, notice)
}

// ── Combined background check (runs once on first chat.message) ──

async function runBackgroundUpdates(pluginDir: string): Promise<string | null> {
  const result = await checkXpGateUpdate()
  await checkPluginUpdate(pluginDir)

  if (result.action === "upgraded") {
    const msg = `[XP-Gate] Auto-upgraded from v${result.localVersion} to v${result.remoteVersion}`
    writeUpgradeNotice({ kind: "upgraded", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  if (result.action === "error") {
    const msg = `[XP-Gate] Upgrade check: v${result.remoteVersion} available (auto-upgrade failed: ${result.error})`
    writeUpgradeNotice({ kind: "error", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  if (result.remoteVersion && result.localVersion && semverLt(result.localVersion, result.remoteVersion)) {
    const msg = `[XP-Gate] New version v${result.remoteVersion} available (you have v${result.localVersion})`
    writeUpgradeNotice({ kind: "outdated", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  return null
}

async function runCmd(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 30000 })
    return stdout || "[XP-Gate] Command completed (no output)."
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string }
    if (error.stderr) return error.stderr
    if (error.message) return `[XP-Gate] Error: ${error.message}`
    return "[XP-Gate] Command failed."
  }
}

async function runXpGate(subcommand: string, cwd: string): Promise<string> {
  try {
    await execAsync("command -v xp-gate", { cwd })
  } catch {
    return ""
  }
  return runCmd(`xp-gate ${subcommand}`, cwd)
}

async function getUpgradeSuggestion(cwd: string): Promise<string> {
  try {
    const result = await runXpGate("upgrade --preview", cwd)
    if (!result) return ""
    const parsed = JSON.parse(result)
    if (parsed.outdated && parsed.remote) {
      const releaseUrl = `https://github.com/boyingliu01/xp-gate/releases/tag/v${parsed.remote}`
      return `[XP-Gate] New version v${parsed.remote} available (${releaseUrl}) — run: xp-gate upgrade`
    }
    return ""
  } catch {
    return ""
  }
}

// ── Session title auto-generation ──

function generateSessionTitle(dbPath: string, sessionId: string): string {
  try {
    const escapedId = sessionId.replace(/'/g, "''")
    const sql = `
      SELECT json_extract(p.data, '$.text') as text
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE m.session_id = '${escapedId}'
        AND json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
      ORDER BY m.time_created DESC
      LIMIT 10
    `
    const raw = execSync(`sqlite3 "${dbPath}" "${sql}"`, {
      encoding: "utf8",
      timeout: 5000,
    })

    if (!raw.trim()) return ""

    const userMessages = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const combined = userMessages.join(" ")
    return extractTitleFromText(combined)
  } catch {
    return ""
  }
}

function extractTitleFromText(text: string): string {
  const taskMarkers = [
    /(?:implement|add|create|build|develop|fix|refactor|optimize|update|remove|merge|deploy|release|publish|design|review)\s+[^.?!\n]{5,80}/gi,
  ]

  const matches: string[] = []
  for (const marker of taskMarkers) {
    const hits = text.matchAll(marker)
    for (const hit of hits) {
      matches.push(hit[0].trim())
    }
  }

  if (matches.length > 0) {
    return matches[0].substring(0, 120)
  }

  const firstSentence = text.split(/[.?!]\s+/).filter(s => s.length > 10)[0]
  if (firstSentence && firstSentence.length > 5) {
    return firstSentence.substring(0, 120).trim()
  }

  return ""
}

// ── Plugin definition ──

export const XpGatePlugin = async (input: OpenCodePluginInput) => {
  const { directory } = input

  return {
    tool: {
      "gate-check": tool({
        description: "Run xp-gate quality gates (Gate 4 + Gate 6) on a file or directory. Prefers global xp-gate CLI; falls back to direct checker source.",
        args: {
          path: z.string().describe("File or directory path (absolute or relative to workspace)"),
          gates: z.array(z.string()).optional().describe("Optional gate subset (e.g. ['principles', 'arch'])"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          const gatesFlag = args.gates?.length ? ` --gates ${args.gates.join(",")}` : ""
          const result = await runXpGate(`check "${target}"${gatesFlag}`, cwd)
          if (result) {
            const upgrade = await getUpgradeSuggestion(cwd)
            return upgrade ? `${result}\n${upgrade}` : result
          }
          const cmd = `node ${directory}/src/npm-package/bin/xp-gate.js check "${target}"${gatesFlag}`
          return runCmd(cmd, cwd)
        },
      }),
      "gate-principles": tool({
        description: "Run Clean Code + SOLID principles checker (Gate 4 standalone) on a file or directory.",
        args: {
          path: z.string().describe("Source file or directory path to check"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          const result = await runXpGate(`principles "${target}"`, cwd)
          if (result) {
            const upgrade = await getUpgradeSuggestion(cwd)
            return upgrade ? `${result}\n${upgrade}` : result
          }
          const cmd = `npx -y tsx ${directory}/src/principles/index.ts --files "${target}" --format console`
          return runCmd(cmd, cwd)
        },
      }),
      "gate-arch": tool({
        description: "Run architecture validation (Gate 6 standalone, layer boundary checks) on the repository.",
        args: {
          config: z.string().describe("Path to architecture config file").default("architecture.yaml"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const config = args.config || "architecture.yaml"
          const result = await runXpGate(`arch --config ${config}`, cwd)
          if (result) {
            const upgrade = await getUpgradeSuggestion(cwd)
            return upgrade ? `${result}\n${upgrade}` : result
          }
          const cmd = `npx -y @archlinter/cli scan . --config ${config}`
          return runCmd(cmd, cwd)
        },
      }),
      "session-reload-model": tool({
        description: "Reload session model from config. After switching provider configs (opencode.json + oh-my-openagent.json via switch-coding-plan.sh), updates the session model in OpenCode DB to match the new config. This ensures restarted sessions use the current provider/model.",
        args: {
          sessionId: z.string().optional().describe("Session ID to reload (defaults to current session)"),
        },
        async execute(args, ctx) {
          const sessionId = args.sessionId || ctx.sessionID
          const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")
          const configDir = join(homedir(), ".config", "opencode")
          const omoConfigPath = join(configDir, "oh-my-openagent.json")

          if (!existsSync(dbPath)) {
            return "Session reload failed: OpenCode database not found at " + dbPath
          }
          if (!existsSync(omoConfigPath)) {
            return "Session reload failed: oh-my-openagent.json not found at " + omoConfigPath
          }

          let omoConfig: Record<string, unknown>
          try {
            omoConfig = JSON.parse(readFileSync(omoConfigPath, "utf8"))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return "Session reload failed: could not parse oh-my-openagent.json: " + msg
          }

          const agents = omoConfig?.["agents"] as Record<string, { model?: string }> | undefined
          const sisyphusModel = agents?.["sisyphus"]?.["model"]
          if (!sisyphusModel || typeof sisyphusModel !== "string") {
            return "Session reload failed: could not find sisyphus.model in oh-my-openagent.json"
          }

          const slashIdx = sisyphusModel.indexOf("/")
          if (slashIdx === -1) {
            return `Session reload failed: model "${sisyphusModel}" is not in provider/model format`
          }
          const providerID = sisyphusModel.substring(0, slashIdx)
          const modelID = sisyphusModel.substring(slashIdx + 1)

          let oldModel = "unknown"
          try {
            const escapedId = sessionId.replace(/'/g, "''")
            const currentRaw = execSync(
              `sqlite3 "${dbPath}" "SELECT model FROM session WHERE id = '${escapedId}'"`,
              { encoding: "utf8", timeout: 5000 }
            ).trim()
            if (currentRaw) {
              try {
                const parsed = JSON.parse(currentRaw)
                oldModel = `${parsed.providerID || "?"}/${parsed.id || "?"}`
              } catch {
                oldModel = currentRaw
              }
            }
          } catch {
            oldModel = "unknown"
          }

          const newModelJson = JSON.stringify({ id: modelID, providerID })
          const escapedId = sessionId.replace(/'/g, "''")
          const escapedModel = newModelJson.replace(/'/g, "''")
          const sql = `UPDATE session SET model = '${escapedModel}', time_updated = ${Date.now()} WHERE id = '${escapedId}'`

          try {
            execSync(`sqlite3 "${dbPath}" "${sql}"`, { timeout: 5000 })
            return `Session model reloaded: ${oldModel} → ${providerID}/${modelID}`
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return `Session reload failed: ${msg}`
          }
        },
      }),
      "session-rename": tool({
        description: "Rename an OpenCode session. When called without newTitle, analyzes the session's recent conversation and auto-generates a descriptive title based on the work done.",
        args: {
          sessionId: z.string().optional().describe("Session ID to rename (defaults to current session)"),
          newTitle: z.string().optional().describe("New session title. If omitted, auto-generates from conversation content."),
        },
        async execute(args, ctx) {
          const sessionId = args.sessionId || ctx.sessionID
          const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")

          if (!existsSync(dbPath)) {
            return "Session rename failed: OpenCode database not found at " + dbPath
          }

          let title: string
          if (args.newTitle) {
            title = args.newTitle
          } else {
            title = generateSessionTitle(dbPath, sessionId)
          }

          if (!title || title.trim().length === 0) {
            return "Session rename failed: could not generate a title (no user messages found)"
          }

          title = title.trim().substring(0, 120)

          const escapedTitle = title.replace(/'/g, "''")
          const escapedId = sessionId.replace(/'/g, "''")
          const sql = `UPDATE session SET title = '${escapedTitle}', time_updated = ${Date.now()} WHERE id = '${escapedId}'`
          try {
            execSync(`sqlite3 "${dbPath}" "${sql}"`, { timeout: 5000 })
            return `Session renamed to: "${title}"`
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return `Session rename failed: ${msg}`
          }
        },
      }),
    },
    "chat.message": async (_input: { message: string }) => {
      if (!checked) {
        checked = true
        const msg = await runBackgroundUpdates(directory).catch(() => null)
        // Primary notification: upgrade-notice.json → TUI sidebar banner
        // Fallback: stderr for users without TUI panel registered
        if (msg) process.stderr.write(`${msg}\n`)
      }
    },
  }
}

const pluginModule = {
  id: "xp-gate",
  server: XpGatePlugin,
}

export default pluginModule
