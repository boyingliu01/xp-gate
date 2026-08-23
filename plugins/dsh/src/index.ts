import { defineTool } from "@deepseek-ai/dsh-tools"
import type { Context } from "@deepseek-ai/cordis"
import { GATE_WHITELIST, buildCommand, resolveTarget } from "./command.js"
import { runXpGate } from "./gate-runner.js"

export const name = "tool-xp-gate"
export const inject = ["tools", "shell"]

const DEFAULT_TIMEOUT_MS = 120_000

export function apply(ctx: Context, _config: unknown = {}): void {
  const shell = ctx.shell

  ctx.tools.register(
    defineTool({
      name: "gate-check",
      description:
        "Run XP-Gate quality gates (xp-gate check) on a file or directory and return the gate report. Prefers the global xp-gate CLI and degrades to an actionable install hint when it is absent.",
      parameters: {
        path: {
          type: "string",
          required: true,
          description: "File or directory path to check (absolute or relative to the workspace).",
        },
        gates: {
          type: "array",
          items: { type: "string", enum: GATE_WHITELIST },
          description: "Optional gate subset to run (e.g. ['principles', 'arch']).",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      async execute(args, exec) {
        const cwd = exec.agent?.session.header.cwd ?? process.cwd()
        const target = resolveTarget(args.path, cwd)
        const command = buildCommand({ subcommand: "check", target, gates: args.gates })
        return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "gate-principles",
      description:
        "Run the 14 Clean Code / SOLID rules (xp-gate principles, Gate 4) on a file or directory and return the principles report.",
      parameters: {
        path: {
          type: "string",
          required: true,
          description: "File or directory path to check (absolute or relative to the workspace).",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      async execute(args, exec) {
        const cwd = exec.agent?.session.header.cwd ?? process.cwd()
        const target = resolveTarget(args.path, cwd)
        const command = buildCommand({ subcommand: "principles", target })
        return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "gate-arch",
      description:
        "Run architecture validation (xp-gate arch, Gate 6) using the given config file and return the architecture report. Defaults to architecture.yaml.",
      parameters: {
        config: {
          type: "string",
          description: "Architecture config file path (defaults to architecture.yaml).",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      async execute(args, exec) {
        const cwd = exec.agent?.session.header.cwd ?? process.cwd()
        const command = buildCommand({ subcommand: "arch", config: args.config })
        return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
      },
    }),
  )
}