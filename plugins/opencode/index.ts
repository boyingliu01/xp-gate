/**
 * XP-Gate OpenCode Plugin
 *
 * Exposes 3 custom tools for OpenCode users:
 *  - gate-check:      Run all xp-gate quality checks on a file or directory
 *  - gate-principles: Run Clean Code + SOLID principles checker
 *  - gate-arch:       Run architecture validation
 *
 * Graceful degradation: if xp-gate CLI not installed, tools return install instructions.
 */
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export const XpGatePlugin: Plugin = async (input) => {
  const { directory, $ } = input

  return {
    tool: {
      "gate-check": tool({
        description:
          "Run xp-gate quality checks on a file or directory. Requires xp-gate CLI installed globally.",
        args: {
          path: z.string().describe("File or directory path (absolute or relative to workspace)"),
          gates: z.array(z.string()).optional().describe("Optional gate subset (e.g. ['principles', 'tests'])"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          const gates = args.gates?.length ? ` --gates ${args.gates.join(",")}` : ""
          try {
            const result = await $`bash -c ${`cd "${cwd}" && command -v xp-gate >/dev/null 2>&1 && xp-gate check "${target}"${gates}`}`
            const text = await result.text()
            return text || "[XP-Gate] Check complete."
          } catch (err: unknown) {
            return `[XP-Gate] xp-gate CLI not found.\nInstall: npm install -g xp-gate\n${err instanceof Error ? err.message : ""}`
          }
        },
      }),
      "gate-principles": tool({
        description:
          "Run Clean Code + SOLID principles checker on a file.",
        args: {
          path: z.string().describe("Source file path to check"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          const cmd = `cd "${cwd}" && npx -y tsx src/principles/index.ts --files "${target}" --format console`
          try {
            const result = await $`bash -c ${cmd}`
            const text = await result.text()
            return text || "[XP-Gate] Principles check complete."
          } catch (err: unknown) {
            return `[XP-Gate] Principles checker failed.\nEnsure src/principles/index.ts exists.\n${err instanceof Error ? err.message : ""}`
          }
        },
      }),
      "gate-arch": tool({
        description:
          "Run architecture validation (layer boundary checks) on the repository.",
        args: {
          config: z.string().describe("Path to architecture config file").default("architecture.yaml"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          try {
            const result = await $`bash -c ${`cd "${cwd}" && npx archlint check --config ${args.config}`}`
            const text = await result.text()
            return text || "[XP-Gate] Architecture check complete."
          } catch (err: unknown) {
            return `[XP-Gate] Architecture validation requires archlint + ${args.config}.\n${err instanceof Error ? err.message : ""}`
          }
        },
      }),
    },
  }
}

const pluginModule: PluginModule = {
  id: "xp-gate",
  server: XpGatePlugin,
}

export default pluginModule
