/**
 * XP-Gate OpenCode Plugin
 *
 * Exposes 3 custom tools for OpenCode users:
 *  - gate-check:     Run all xp-gate quality checks on a file or directory
 *  - gate-principles: Run Clean Code + SOLID principles checker
 *  - gate-arch:      Run architecture validation
 *
 * Graceful degradation: if xp-gate CLI not installed, tools return helpful install instructions.
 */
import type { Plugin } from "@opencode-ai/plugin"

interface ShellRunner {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>
}

interface PluginInput {
  directory: string
  $: ShellRunner
}

interface ToolContext {
  directory: string
}

interface ToolArgs {
  path: string
  gates?: string[]
}

async function runShellCommand(
  shell: ShellRunner,
  command: string,
  fallbackMessage: string,
): Promise<string> {
  try {
    const result = await shell`bash -c ${command}`
    return result.stdout || result.stderr || "Command completed (no output)"
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return `${fallbackMessage}\n\nError: ${errorMsg}`
  }
}

function resolvePath(directory: string, path: string): string {
  return path.startsWith("/") ? path : `${directory}/${path}`
}

export const XpGatePlugin: Plugin = async (input: PluginInput) => {
  const { directory, $ } = input

  return {
    tool: {
      "gate-check": {
        description:
          "Run xp-gate quality checks on a file or directory (6 gates: code quality, duplicate code, complexity, principles, tests, architecture). Requires xp-gate CLI installed globally.",
        async execute(args: ToolArgs, context: ToolContext): Promise<string> {
          const cwd = context.directory || directory
          const targetPath = resolvePath(cwd, args.path)
          const gatesArg = args.gates && args.gates.length > 0 ? ` --gates ${args.gates.join(",")}` : ""
          const cmd = `cd "${cwd}" && command -v xp-gate >/dev/null 2>&1 && xp-gate check "${targetPath}"${gatesArg}`
          return runShellCommand(
            $,
            cmd,
            "[XP-Gate] CLI not found. Install: npm install -g xp-gate",
          )
        },
      },
      "gate-principles": {
        description:
          "Run Clean Code + SOLID principles checker on a file (checks: function length, nesting depth, god class, parameters, naming, magic numbers).",
        async execute(args: ToolArgs, context: ToolContext): Promise<string> {
          const cwd = context.directory || directory
          const targetPath = resolvePath(cwd, args.path)
          const cmd = `cd "${cwd}" && npx -y tsx src/principles/index.ts --files "${targetPath}" --format console`
          return runShellCommand(
            $,
            cmd,
            "[XP-Gate] Principles checker requires repo source. Ensure src/principles/index.ts exists.",
          )
        },
      },
      "gate-arch": {
        description:
          "Run architecture validation (layer boundary checks, ARCH-001 to ARCH-014 rules) on the repository.",
        async execute(_args: ToolArgs, context: ToolContext): Promise<string> {
          const cwd = context.directory || directory
          const cmd = `cd "${cwd}" && npx archlint check --config architecture.yaml`
          return runShellCommand(
            $,
            cmd,
            "[XP-Gate] Architecture validation requires archlint + architecture.yaml in repo root.",
          )
        },
      },
    },
  }
}

export default XpGatePlugin
