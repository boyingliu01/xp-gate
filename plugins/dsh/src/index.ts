import { defineTool } from "@deepseek-ai/dsh-tools"
import type { Context } from "@deepseek-ai/cordis"
import { GATE_WHITELIST, buildCommand, detectDialect, resolveTarget } from "./command.js"
import { runXpGate } from "./gate-runner.js"
import { DelphiSetupError, loadDelphiConfig, toDelphiOptions } from "./delphi-config.js"
import { formatOutcome, runReview } from "./delphi-run.js"

export const name = "tool-xp-gate"
export const inject = ["tools", "shell"]

const DEFAULT_TIMEOUT_MS = 120_000

export function apply(ctx: Context, _config: unknown = {}): void {
  const shell = ctx.shell
  // DSH runs a POSIX shell off-Windows and PowerShell on Windows; generating the
  // wrong dialect makes every tool fail to parse rather than degrade gracefully.
  const dialect = detectDialect()

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
        const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
        const target = resolveTarget(args.path, cwd)
        const command = buildCommand({ subcommand: "check", target, gates: args.gates, dialect })
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
        const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
        const target = resolveTarget(args.path, cwd)
        const command = buildCommand({ subcommand: "principles", target, dialect })
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
        const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
        const command = buildCommand({ subcommand: "arch", config: args.config, dialect })
        return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
      },
    }),
  )

  // Delphi multi-model cross-review.
  //
  // DSH's own subagents cannot do this: they inherit one host-configured model,
  // so three "experts" would be three instances of the same model, and Delphi's
  // value rests entirely on the reviewers being DIFFERENT models. This tool
  // therefore calls an external OpenAI-compatible provider directly, with one
  // distinct model per seat.
  ctx.tools.register(
    defineTool({
      name: "delphi-review",
      description:
        "Run a Delphi cross-review of a subject (a diff, a design, a spec) using three DISTINCT models from an external OpenAI-compatible provider configured in .delphi-config.json. Round 1 is anonymous and concurrent; later rounds feed back the aggregate until the approval ratio reaches the configured threshold (default 90%) or the round cap (default 5). Use this whenever a change needs independent multi-model review rather than a single model's opinion.",
      parameters: {
        subject: {
          type: "string",
          required: true,
          description:
            "The material to review, inline. For a diff, pass the diff text (or a summarized form if very large).",
        },
        addressed: {
          type: "string",
          description:
            "Optional description of what changed since a previous round, fed back to later rounds so reviewers can revise their position.",
        },
        maxRounds: {
          type: "number",
          description: "Override the configured round cap (Delphi default is 5).",
        },
        cwd: {
          type: "string",
          description: "Project root containing .delphi-config.json (defaults to the session cwd).",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      // Multi-round reviews over large inputs are slow; the transport applies
      // its own per-request timeout on top of this ceiling.
      timeoutMs: 900_000,
      async execute(args, exec) {
        const cwd = args.cwd ?? exec.agent?.session?.header?.cwd ?? process.cwd()
        try {
          const cfg = loadDelphiConfig(cwd)
          const outcome = await runReview(
            { ...toDelphiOptions(cfg), maxRounds: args.maxRounds ?? cfg.maxRounds },
            args.subject,
            args.addressed ?? "",
          )
          const seats = cfg.seats.map((s) => s.model).join(", ")
          return `${formatOutcome(outcome)}\n\nProvider: ${cfg.provider}\nSeats: ${seats}`
        } catch (e) {
          // Config problems are the common failure; report them as guidance
          // rather than a stack trace.
          if (e instanceof DelphiSetupError) return `Delphi review not started: ${e.message}`
          throw e
        }
      },
    }),
  )
}