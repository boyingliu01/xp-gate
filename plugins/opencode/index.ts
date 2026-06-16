import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const execAsync = promisify(exec)

interface OpenCodePluginInput {
  directory: string
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): Promise<string> }>
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

// ── Auto-update check for opencode-plugin ──

const CACHE_TTL_MS = 86_400_000
const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/@boyingliu01%2Fopencode-plugin/dist-tags"
const FETCH_TIMEOUT_MS = 5_000
const CACHE_FILE = join(homedir(), ".xp-gate", "opencode-plugin-version-check.json")

let checked = false
let checkInFlight: Promise<void> | null = null

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

async function checkPluginUpdate(pluginDir: string): Promise<void> {
  if (checkInFlight) return

  checkInFlight = (async () => {
    try {
      mkdirSync(join(homedir(), ".xp-gate"), { recursive: true })

      if (existsSync(CACHE_FILE)) {
        const cached = JSON.parse(readFileSync(CACHE_FILE, "utf8"))
        if (Date.now() - cached.ts < CACHE_TTL_MS) return
      }

      let localVersion = ""
      try {
        const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"))
        localVersion = pkg.version || ""
      } catch {
        return
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal })
        if (!response.ok) return
        const data: Record<string, unknown> = await response.json()
        const remoteVersion = String(data.latest || "")

        if (remoteVersion && localVersion && semverLt(localVersion, remoteVersion)) {
          writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), localVersion, remoteVersion }))
          process.stderr.write(
            `[XP-Gate] New opencode-plugin version v${remoteVersion} available (you have v${localVersion})\n` +
            `[XP-Gate] Update with: cd ~/.config/opencode && npm update @boyingliu01/opencode-plugin\n`
          )
        } else if (remoteVersion && localVersion) {
          // Cache "up to date" to avoid re-fetching every session
          writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), localVersion, remoteVersion, status: "current" }))
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // All errors silently ignored
    }
  })()

  await checkInFlight
  checkInFlight = null
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
    },
    "chat.message": async (_input: { message: string }) => {
      if (!checked) {
        checked = true
        checkPluginUpdate(directory).catch(() => {})
      }
      return { action: "continue" }
    },
  }
}

const pluginModule = {
  id: "xp-gate",
  server: XpGatePlugin,
}

export default pluginModule
