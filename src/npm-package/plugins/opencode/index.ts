/**
 * XP-Gate OpenCode Plugin
 *
 * Exposes 3 OpenCode tools that mirror the equivalent `xp-gate` CLI subcommands:
 *  - gate-check:      Run user-invokable quality gates (Gate 4 Principles + Gate 6 Arch) on a path
 *  - gate-principles: Run Clean Code + SOLID principles checker (Gate 4 standalone)
 *  - gate-arch:       Run architecture validation (Gate 6 standalone)
 *
 * Dual-surface design (fixes #208): every tool is callable BOTH from inside an
 * OpenCode session (as these tools) AND from a plain shell (as `xp-gate check`,
 * `xp-gate principles`, `xp-gate arch`). The tools prefer the global `xp-gate`
 * CLI when available, but fall back to running the checker source directly via
 * `npx -y tsx` so they work even before `npm install -g @boyingliu01/xp-gate`.
 */
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

interface OpenCodePluginInput {
  directory: string
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): Promise<string> }>
}

export const XpGatePlugin = async (input: OpenCodePluginInput) => {
  const { directory, $ } = input

  return {
    tool: {
      "gate-check": tool({
        description:
          "Run xp-gate user-invokable quality gates (Gate 4 Principles + Gate 6 Architecture) on a file or directory. Prefers global xp-gate CLI; falls back to running checker source directly.",
        args: {
          path: z.string().describe("File or directory path (absolute or relative to workspace)"),
          gates: z.array(z.string()).optional().describe("Optional gate subset (e.g. ['principles', 'arch'])"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          const gatesFlag = args.gates?.length ? ` --gates ${args.gates.join(",")}` : ""
          // Prefer the installed xp-gate CLI. Fall back to invoking the same
          // subcommand source directly via npx tsx so the tool still works in
          // a fresh clone before `npm install -g @boyingliu01/xp-gate`.
          const cmd = `cd "${cwd}" && (command -v xp-gate >/dev/null 2>&1 && xp-gate check "${target}"${gatesFlag} || node ${directory}/src/npm-package/bin/xp-gate.js check "${target}"${gatesFlag})`
          try {
            const result = await $`bash -c ${cmd}`
            const text = await result.text()
            return text || "[XP-Gate] Check complete (no violations)."
          } catch (err) {
            return `[XP-Gate] gate-check failed.\nInstall xp-gate CLI: npm install -g @boyingliu01/xp-gate\n${err instanceof Error ? err.message : ""}`
          }
        },
      }),
      "gate-principles": tool({
        description:
          "Run Clean Code + SOLID principles checker (Gate 4 standalone) on a file or directory.",
        args: {
          path: z.string().describe("Source file or directory path to check"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          const target = args.path.startsWith("/") ? args.path : `${cwd}/${args.path}`
          // Try xp-gate CLI first, fall back to the principles source directly.
          const cmd = `cd "${cwd}" && (command -v xp-gate >/dev/null 2>&1 && xp-gate principles "${target}" || npx -y tsx ${directory}/src/principles/index.ts --files "${target}" --format console)`
          try {
            const result = await $`bash -c ${cmd}`
            const text = await result.text()
            return text || "[XP-Gate] Principles check complete (no violations)."
          } catch (err) {
            return `[XP-Gate] Principles checker failed.\nInstall xp-gate CLI: npm install -g @boyingliu01/xp-gate\n${err instanceof Error ? err.message : ""}`
          }
        },
      }),
      "gate-arch": tool({
        description:
          "Run architecture validation (Gate 6 standalone, layer boundary checks) on the repository.",
        args: {
          config: z.string().describe("Path to architecture config file").default("architecture.yaml"),
        },
        async execute(args, ctx) {
          const cwd = ctx.directory || directory
          // Prefer xp-gate CLI; fall back to @archlinter/cli directly so the tool
          // also works without xp-gate installed (matches gate-principles pattern).
          const cmd = `cd "${cwd}" && (command -v xp-gate >/dev/null 2>&1 && xp-gate arch --config ${args.config} || npx -y @archlinter/cli scan . --config ${args.config})`
          try {
            const result = await $`bash -c ${cmd}`
            const text = await result.text()
            return text || "[XP-Gate] Architecture check complete."
          } catch (err) {
            return `[XP-Gate] Architecture validation failed.\nRequires architecture.yaml in repo root.\nInstall xp-gate CLI: npm install -g @boyingliu01/xp-gate\n${err instanceof Error ? err.message : ""}`
          }
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
