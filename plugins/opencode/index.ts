import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

interface OpenCodePluginInput {
  directory: string
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): Promise<string> }>
}

/**
 * Run a shell command via async exec, returning stdout or error message.
 * Never throws — returns error string on failure.
 */
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

/**
 * Check for xp-gate CLI availability and run a command via exec.
 */
async function runXpGate(subcommand: string, cwd: string): Promise<string> {
  // Check if xp-gate is on PATH
  try {
    await execAsync("command -v xp-gate", { cwd })
  } catch {
    return ""  // CLI not available — caller should fall back
  }
  return runCmd(`xp-gate ${subcommand}`, cwd)
}

/**
 * Check for a newer xp-gate version (non-blocking, advisory only).
 */
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
          // Fallback: invoke xp-gate source directly via node
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
          // Fallback: npx tsx on the principles source
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
          // Fallback: @archlinter/cli directly
          const cmd = `npx -y @archlinter/cli scan . --config ${config}`
          return runCmd(cmd, cwd)
        },
      }),
    },
  }
}

const pluginModule = {
  id: "xp-gate",
  server: XpGatePlugin,
}

export default pluginModule
