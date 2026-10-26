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

/**
 * Decide whether an upgrade is worth attempting, without performing one.
 *
 * Split out of `checkXpGateUpdate` (CCN 14). That function interleaved five
 * "return noop for this reason" branches with the install itself, so the
 * conditions that STOP an upgrade and the act of upgrading were one readable
 * blob. Separating them means the decision can be read (and tested) on its own.
 */
type UpgradeDecision =
  | { kind: "noop"; localVersion: string | null; remoteVersion: string | null }
  | { kind: "install"; localVersion: string; remoteVersion: string }

/**
 * Is the cached answer still a truthful description of this install?
 *
 * A cache records the version it was computed FOR. After a manual upgrade the
 * local version differs, so the cache describes a different install and must be
 * re-derived -- otherwise a user who upgrades by hand is never checked again.
 */
function cacheStillDescribes(
  cached: { remoteVersion: string; localVersion?: string; status?: string } | null,
  localVersion: string | null,
): cached is { remoteVersion: string; localVersion: string; status: "current" } {
  if (!cached) return false
  if (cached.status !== "current") return false
  if (!cached.remoteVersion || !localVersion) return false
  return cached.localVersion === localVersion
}

async function decideUpgrade(): Promise<UpgradeDecision> {
  const localVersion = getLocalXpGateVersion()
  const cached = readCache(XP_GATE_CACHE_FILE)

  if (cacheStillDescribes(cached, localVersion)) {
    return { kind: "noop", localVersion, remoteVersion: cached.remoteVersion }
  }

  if (!localVersion) return { kind: "noop", localVersion: null, remoteVersion: null }

  const remoteVersion = await fetchNpmLatestVersion(XP_GATE_REGISTRY_URL)
  if (!remoteVersion) return { kind: "noop", localVersion, remoteVersion: null }

  const upToDate = !semverLt(localVersion, remoteVersion)
  // The opt-out is checked AFTER the version comparison so that recording
  // "current" is still correct for an opted-out user; skipping it would make the
  // next run re-query the registry every time.
  const optedOut = readXpGateConfig()?.autoUpgrade === false
  if (upToDate || optedOut) {
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { kind: "noop", localVersion, remoteVersion }
  }

  return { kind: "install", localVersion, remoteVersion }
}

/**
 * Run `npm install -g` for one version.
 *
 * Resolves with the exit code rather than throwing on a non-zero exit: a failed
 * install is a reported condition ("error"), not an exception the caller has to
 * guess the meaning of. A spawn that could not start at all still rejects -- that
 * is a different failure (no npm on PATH) and the caller must see it.
 *
 * The spawn call is guarded as well as listening for the 'error' event: both are
 * reachable (the event covers an async ENOENT, the guard covers a synchronous
 * throw such as an invalid argument), and an unhandled one here would escape into
 * the host's chat loop.
 */
function installGlobally(version: string): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    let child;
    try {
      child = spawn("npm", ["install", "-g", `${XP_GATE_NPM_PKG}@${version}`], {
        stdio: "pipe",
        shell: true,  // Required on Windows: npm is a .cmd file
        timeout: 120_000,
      })
    } catch (err) {
      reject(err)
      return
    }
    child.on("close", (code) => resolve(code))
    child.on("error", (err) => reject(err))
  })
}

async function checkXpGateUpdate(): Promise<UpgradeResult> {
  const decision = await decideUpgrade()
  if (decision.kind === "noop") {
    return {
      action: "noop",
      localVersion: decision.localVersion,
      remoteVersion: decision.remoteVersion,
    }
  }

  const { localVersion, remoteVersion } = decision
  writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion })
  try {
    const exitCode = await installGlobally(remoteVersion)
    if (exitCode !== 0) {
      return { action: "error", localVersion, remoteVersion, error: `npm install exited with code ${exitCode}` }
    }
    // Record the NEW version as local: the install succeeded, so the next run
    // must not offer the same upgrade again.
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion: remoteVersion, remoteVersion, status: "current" })
    return { action: "upgraded", localVersion, remoteVersion }
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

/** The plugin's own installed version, or null when it cannot be read. */
function readInstalledPluginVersion(pluginDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"))
    return pkg.version || null
  } catch {
    return null
  }
}

async function checkPluginUpdate(pluginDir: string): Promise<void> {
  const cached = readCache(OPENCODE_CACHE_FILE)
  if (cached?.status === "current" && cached.remoteVersion) return

  const localVersion = readInstalledPluginVersion(pluginDir)
  if (!localVersion) return

  const remoteVersion = await fetchNpmLatestVersion(OPENCODE_PLUGIN_REGISTRY)
  if (!remoteVersion) return

  // The presence or absence of `status: "current"` is the whole message: with it
  // the caller stays quiet, without it a notice is owed. It used to be expressed
  // as an if/else-if that re-tested `remoteVersion && localVersion` in both arms,
  // even though both were already known non-empty by this point.
  const upToDate = !semverLt(localVersion, remoteVersion)
  const entry: { ts: number; localVersion: string; remoteVersion: string; status?: string } = {
    ts: Date.now(), localVersion, remoteVersion,
  }
  if (upToDate) entry.status = "current"
  writeCache(OPENCODE_CACHE_FILE, entry)
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

const SQLITE_TIMEOUT_MS = 5_000

// Boy Scout (#447): XpGatePlugin used to inline five tool({...}) definitions
// (191 lines, 7-8 brace levels). Each tool now lives in its own factory;
// XpGatePlugin is pure wiring.
function gateCheckTool(directory: string) {
  return tool({
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
  })
}

function gatePrinciplesTool(directory: string) {
  return tool({
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
  })
}

function gateArchTool(directory: string) {
  return tool({
    description:
      "Run architecture validation (Gate 6 standalone) on the repository with the pinned local @archlinter/cli built-in rules and baseline ratchet.",
    args: {
      config: z
        .string()
        .optional()
        .describe(
          "Optional architecture config file (opts into archlint --config; pre-0.16 schemas are rejected by archlint itself)",
        ),
    },
    async execute(args, ctx) {
      const cwd = ctx.directory || directory
      // #447: default to the built-in-rules path — no --config. Forcing
      // `--config architecture.yaml` hit the pre-0.16 schema archlint rejects.
      const archArgs = args.config ? `arch --use-config ${args.config}` : "arch"
      const result = await runXpGate(archArgs, cwd)
      if (result) {
        const upgrade = await getUpgradeSuggestion(cwd)
        return upgrade ? `${result}\n${upgrade}` : result
      }
      const fallback = args.config
        ? `npx -y @archlinter/cli scan . --config ${args.config}`
        : `npx -y @archlinter/cli scan .`
      return runCmd(fallback, cwd)
    },
  })
}

function readCurrentSessionModel(dbPath: string, sessionId: string): string {
  try {
    const escapedId = sessionId.replace(/'/g, "''")
    const currentRaw = execSync(
      `sqlite3 "${dbPath}" "SELECT model FROM session WHERE id = '${escapedId}'"`,
      { encoding: "utf8", timeout: SQLITE_TIMEOUT_MS }
    ).trim()
    if (!currentRaw) return "unknown"
    try {
      const parsed = JSON.parse(currentRaw)
      return `${parsed.providerID || "?"}/${parsed.id || "?"}`
    } catch {
      return currentRaw
    }
  } catch {
    return "unknown"
  }
}

function writeSessionModel(dbPath: string, sessionId: string, modelJson: string): void {
  const escapedId = sessionId.replace(/'/g, "''")
  const escapedModel = modelJson.replace(/'/g, "''")
  const sql = `UPDATE session SET model = '${escapedModel}', time_updated = ${Date.now()} WHERE id = '${escapedId}'`
  try {
    execSync(`sqlite3 "${dbPath}" "${sql}"`, { timeout: SQLITE_TIMEOUT_MS })
  } catch (err) {
    // Contract is to propagate: the caller renders the failure as
    // "Session reload failed: <message>". Wrapped so the IO sits inside
    // error handling (Boy Scout), not to swallow anything.
    throw err
  }
}

// Boy Scout (#447): the tool's execute() body inlined 40+ lines at 5 brace
// levels (tool → execute → try → JSON.stringify options). The logic lives at
// module scope; execute() is pure wiring.
/**
 * The config a session-model reload needs, or the reason it cannot proceed.
 *
 * Split out of `reloadSessionModel` (CCN 14): the function was six preconditions
 * plus one action, and each precondition owns a distinct diagnostic. Keeping them
 * as one linear chain made the failure paths hard to read and impossible to test
 * individually; returning a discriminated result lets the caller stay flat.
 */
type ReloadInputs =
  | { ok: true; dbPath: string; providerID: string; modelID: string }
  | { ok: false; reason: string }

function readReloadInputs(): ReloadInputs {
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(dbPath)) {
    return { ok: false, reason: "Session reload failed: OpenCode database not found at " + dbPath }
  }

  const omoConfigPath = join(homedir(), ".config", "opencode", "oh-my-openagent.json")
  if (!existsSync(omoConfigPath)) {
    return { ok: false, reason: "Session reload failed: oh-my-openagent.json not found at " + omoConfigPath }
  }

  const parsed = parseOmoConfig(omoConfigPath)
  if (typeof parsed === "string") return { ok: false, reason: parsed }

  const model = readSisyphusModel(parsed)
  if (typeof model === "string" && model.startsWith("Session reload failed")) {
    return { ok: false, reason: model }
  }

  const slashIdx = (model as string).indexOf("/")
  if (slashIdx === -1) {
    return { ok: false, reason: `Session reload failed: model "${model}" is not in provider/model format` }
  }

  return {
    ok: true,
    dbPath,
    providerID: (model as string).substring(0, slashIdx),
    modelID: (model as string).substring(slashIdx + 1),
  }
}

/** The parsed config object, or the failure message. */
function parseOmoConfig(path: string): Record<string, unknown> | string {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return "Session reload failed: could not parse oh-my-openagent.json: " + msg
  }
}

/** The configured sisyphus model id, or the failure message. */
function readSisyphusModel(config: Record<string, unknown>): string {
  const agents = config?.["agents"] as Record<string, { model?: string }> | undefined
  const model = agents?.["sisyphus"]?.["model"]
  if (!model || typeof model !== "string") {
    return "Session reload failed: could not find sisyphus.model in oh-my-openagent.json"
  }
  return model
}

function reloadSessionModel(sessionId: string): string {
  const inputs = readReloadInputs()
  if (!inputs.ok) return inputs.reason

  const { dbPath, providerID, modelID } = inputs
  const oldModel = readCurrentSessionModel(dbPath, sessionId)
  try {
    writeSessionModel(dbPath, sessionId, JSON.stringify({ id: modelID, providerID }))
    return `Session model reloaded: ${oldModel} → ${providerID}/${modelID}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Session reload failed: ${msg}`
  }
}

function sessionReloadModelTool() {
  return tool({
    description: "Reload session model from config. After switching provider configs (opencode.json + oh-my-openagent.json via switch-coding-plan.sh), updates the session model in OpenCode DB to match the new config. This ensures restarted sessions use the current provider/model.",
    args: {
      sessionId: z.string().optional().describe("Session ID to reload (defaults to current session)"),
    },
    async execute(args, ctx) {
      return reloadSessionModel(args.sessionId || ctx.sessionID)
    },
  })
}

// Boy Scout (#447): same treatment as reloadSessionModel — logic at module
// scope, execute() is pure wiring.
function renameSession(sessionId: string, newTitle?: string): string {
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")

  if (!existsSync(dbPath)) {
    return "Session rename failed: OpenCode database not found at " + dbPath
  }

  // `||` (not `??`): an explicitly empty title falls back to auto-generation,
  // matching the original if/else.
  const title = newTitle || generateSessionTitle(dbPath, sessionId)
  if (!title || title.trim().length === 0) {
    return "Session rename failed: could not generate a title (no user messages found)"
  }

  const trimmed = title.trim().substring(0, 120)
  const escapedTitle = trimmed.replace(/'/g, "''")
  const escapedId = sessionId.replace(/'/g, "''")
  const sql = `UPDATE session SET title = '${escapedTitle}', time_updated = ${Date.now()} WHERE id = '${escapedId}'`
  try {
    execSync(`sqlite3 "${dbPath}" "${sql}"`, { timeout: SQLITE_TIMEOUT_MS })
    return `Session renamed to: "${trimmed}"`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Session rename failed: ${msg}`
  }
}

function sessionRenameTool() {
  return tool({
    description: "Rename an OpenCode session. When called without newTitle, analyzes the session's recent conversation and auto-generates a descriptive title based on the work done.",
    args: {
      sessionId: z.string().optional().describe("Session ID to rename (defaults to current session)"),
      newTitle: z.string().optional().describe("New session title. If omitted, auto-generate from conversation content."),
    },
    async execute(args, ctx) {
      return renameSession(args.sessionId || ctx.sessionID, args.newTitle)
    },
  })
}

export const XpGatePlugin = async (input: OpenCodePluginInput) => {
  const { directory } = input

  return {
    tool: {
      "gate-check": gateCheckTool(directory),
      "gate-principles": gatePrinciplesTool(directory),
      "gate-arch": gateArchTool(directory),
      "session-reload-model": sessionReloadModelTool(),
      "session-rename": sessionRenameTool(),
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

/**
 * Internals exposed for the test suite.
 *
 * This module had 560 lines and 27 functions with no tests at all, so nothing
 * could be changed safely -- including the CCN=48 update callback. The pure
 * helpers are re-exported here so their behaviour can be pinned (REQ-625)
 * before and after the refactor that brings the complexity down.
 *
 * Not part of the plugin's public surface: the host loads `default`, and nothing
 * here is a tool or a hook.
 */
export const __test = {
  semverLt,
  readCache,
  writeCache,
  extractTitleFromText,
  getLocalXpGateVersion,
  checkXpGateUpdate,
  checkPluginUpdate,
  runBackgroundUpdates,
  reloadSessionModel,
  renameSession,
  XP_GATE_CACHE_FILE,
  OPENCODE_CACHE_FILE,
}

export default pluginModule
