import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { CredentialProvider } from "@deepseek-ai/dsh-credentials"
import { defineTool } from "@deepseek-ai/dsh-tools"
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import type { ShellDialect } from "./command.js"
import { GATE_WHITELIST, buildCommand, detectDialectForShell, resolveTarget } from "./command.js"
import { runXpGate } from "./gate-runner.js"
import type { ResolvedDelphiConfig } from "./delphi-config.js"
import {
  DelphiSetupError,
  expandEnvDetailed,
  listCredentialReferences,
  loadDelphiConfig,
  toDelphiOptions,
} from "./delphi-config.js"
import type { DelphiOptions } from "./delphi.js"
import { DelphiConfigError } from "./delphi.js"
import type { DelphiSettingsLayer } from "./delphi-settings.js"
import { seatsFromSettings } from "./delphi-settings.js"
import type { ReviewOutcome } from "./delphi-run.js"
import { formatOutcome, runReview } from "./delphi-run.js"
import { buildEvidence } from "./evidence.js"
import { readGitContext } from "./git-context.js"
import { delphiGuardDecision, isCheckablePath, isEditTool } from "./hooks.js"
import { PHASE_STATUSES, SPRINT_SUBCOMMANDS, buildSprintCommand } from "./sprint.js"
import { createSkillProvider } from "./skill-provider.js"
import type { ApiKeyResolver } from "./credentials.js"
import { createCredentialResolver } from "./credentials.js"

/**
 * Renders a tool's string result as plain text.
 *
 * Extracted because five tools had written this identical closure inline, which
 * left five separate uncovered functions in the coverage report for one line of
 * behaviour (#562). One definition can be tested once and reads as what it is: a
 * shared output convention, not five coincidences.
 *
 * Generic in the argument type on purpose. `defineTool` types `render` as
 * `(args: <this tool's parameters>, value: string) => ContentBlock[]`, so a
 * `(_args: unknown, ...)` implementation is NOT assignable to it -- `unknown` is
 * the wrong direction for a parameter. Declaring it as `A` lets every call site
 * infer its own argument shape while the return type stays a plain text block.
 *
 * This mismatch was caught by `tsc` in the publish job, not by the test suite:
 * vitest transpiles without type-checking. A green test run is not a green build.
 */
export const renderText = <A>(_args: A, value: string) => [{ type: "text" as const, text: value }]

export const name = "tool-xp-gate"
// "skills" is required: the bundled skill provider registers during apply(), and
// without it ctx.skills may not be mounted yet when this plugin starts.
export const inject = ["tools", "shell", "skills"]

/**
 * Absolute path to the skills directory shipped alongside this module.
 *
 * Resolved from `import.meta.url` rather than `process.cwd()`: after an npm
 * install the plugin lives in the profile's node_modules, so the working
 * directory says nothing about where its assets are. This is the same
 * resolution the official `@deepseek-ai/dsh-skill-office` uses.
 */
function bundledSkillsRoot(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url))
}

const DEFAULT_TIMEOUT_MS = 120_000
// Multi-round reviews over large inputs are slow; the transport applies its
// own per-request timeout on top of this ceiling.
const DELPHI_TIMEOUT_MS = 900_000

/** The document Gate MW reads at push time. */
const EVIDENCE_FILE = ".code-walkthrough-result.json"

/**
 * Files already reported on in this process.
 *
 * Server-lifetime rather than session-lifetime on purpose: the addon outlives any
 * one session, and re-reporting the same unchanged file to a second session would
 * spend a subprocess to repeat something already said.
 */
const checkedThisSession = new Set<string>()

// Boy Scout (#447): gate-check's `gates` parameter nests one level too deep
// inline (parameters → gates → items), so the schema lives at module scope.
const GATES_PARAMETER = {
  type: "array",
  items: { type: "string", enum: GATE_WHITELIST },
  description: "Optional gate subset to run (e.g. ['principles', 'arch']).",
} as const

// Boy Scout (#447): apply() used to inline four register(defineTool({...}))
// blocks (149 lines, 5 brace levels). Each tool now lives in its own factory;
// apply() is pure wiring.
function gateCheckTool(shell: Context["shell"], dialect: ShellDialect) {
  return defineTool({
    name: "gate-check",
    description:
      "Run XP-Gate quality gates (xp-gate check) on a file or directory and return the gate report. Prefers the global xp-gate CLI and degrades to an actionable install hint when it is absent.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "File or directory path to check (absolute or relative to the workspace).",
      },
      gates: GATES_PARAMETER,
    },
    output: {
      schema: { type: "string" },
      render: renderText,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const target = resolveTarget(args.path, cwd)
      const command = buildCommand({ subcommand: "check", target, gates: args.gates, dialect })
      return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
    },
  })
}

function gatePrinciplesTool(shell: Context["shell"], dialect: ShellDialect) {
  return defineTool({
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
      render: renderText,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const target = resolveTarget(args.path, cwd)
      const command = buildCommand({ subcommand: "principles", target, dialect })
      return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
    },
  })
}

function gateArchTool(shell: Context["shell"], dialect: ShellDialect) {
  return defineTool({
    name: "gate-arch",
    description:
      "Run architecture validation (xp-gate arch, Gate 6) with the pinned local @archlinter/cli built-in rules and baseline ratchet, and return the architecture report. Pass a config file only to opt into archlint's own --config path (pre-0.16 schemas are rejected by archlint itself).",
    parameters: {
      config: {
        type: "string",
        description:
          "Optional architecture config file (opts into archlint --config; the default built-in-rules path needs none).",
      },
    },
    output: {
      schema: { type: "string" },
      render: renderText,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const command = buildCommand({ subcommand: "arch", config: args.config, dialect })
      return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
    },
  })
}

// Delphi multi-model cross-review.
//
// DSH's own subagents cannot do this: they inherit one host-configured model,
// so three "experts" would be three instances of the same model, and Delphi's
// value rests entirely on the reviewers being DIFFERENT models. This tool
// therefore calls an external OpenAI-compatible provider directly, with one
// distinct model per seat.
// Boy Scout (#447): the review body used to sit inline in execute() at 5 brace
// levels (defineTool → execute → try → runReview options). Module scope keeps
// the try/catch semantics identical while dropping two levels.
/**
 * Write .code-walkthrough-result.json for Gate MW, or explain why it cannot.
 *
 * Returns a suffix for the tool's output rather than throwing: the review itself
 * succeeded, and losing its text because evidence could not be written would be a
 * worse outcome than a clear note that the push gate will not be satisfied.
 */
async function writeWalkthroughEvidence(
  cwd: string,
  cfg: ResolvedDelphiConfig,
  outcome: ReviewOutcome,
): Promise<string> {
  try {
    const lastRound = outcome.rounds[outcome.rounds.length - 1]
    const seats = lastRound.verdicts.map((v) => ({
      role: v.role,
      model: v.requestedModel,
      resolved: v.resolvedModel ?? "",
    }))
    const git = readGitContext(cwd)
    const evidence = buildEvidence({
      head: git.head,
      branch: git.branch,
      seats,
      verdict: outcome.consensus ? "APPROVED" : "REQUEST_CHANGES",
      now: new Date(),
      baseUrl: cfg.baseUrl,
      consensusRatio: outcome.finalRatio,
    })
    const target = join(cwd, EVIDENCE_FILE)
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
    return `\nEvidence: ${EVIDENCE_FILE} written for ${evidence.commit.slice(0, 8)}.`
  } catch (error) {
    return `\nEvidence: not written — ${(error as Error).message}`
  }
}

/** Everything a review needs from the tool call, minus the material under review. */
interface ReviewRequest {
  readonly addressed: string
  readonly maxRounds: number | undefined
  readonly cwd: string
  readonly resolveApiKey: ApiKeyResolver
  readonly signal: AbortSignal | undefined
  readonly writeEvidence: boolean
  /** Seats from the settings page; empty means "read .delphi-config.json". */
  readonly settings: DelphiSettingsLayer | undefined
}

/**
 * Build the review options from whichever source is configured.
 *
 * The settings page wins when it holds seats: it is the more recent edit, and a
 * user who just saved three models expects the next run to use them. When it holds
 * none, `.delphi-config.json` applies exactly as before — which is what keeps every
 * existing project working without opening the page.
 *
 * Both paths end in the same `validateSeats`, so neither can produce a panel the
 * skill would reject.
 */
async function reviewOptions(
  request: ReviewRequest,
  resolveApiKey: ApiKeyResolver,
): Promise<{ options: DelphiOptions; provider: string; described: string; cfg?: ResolvedDelphiConfig }> {
  const fromSettings = seatsFromSettings(request.settings)
  if (fromSettings) {
    // The seat list is already validated; only the key still has to be resolved,
    // and only the credential store (not this process's environment) knows it.
    const key = await resolveExpressionKey(fromSettings.apiKeyExpression, resolveApiKey)
    return {
      options: {
        baseUrl: fromSettings.baseUrl,
        apiKey: key,
        seats: fromSettings.seats,
        thresholdPercent: fromSettings.thresholdPercent,
        maxRounds: request.maxRounds ?? fromSettings.maxRounds,
      },
      provider: "settings",
      described: fromSettings.seats.map((s) => s.model).join(", "),
    }
  }

  // Resolve credentials BEFORE loading the config: the loader is synchronous and
  // throws as soon as a referenced variable has no value. Reading the reference
  // names first turns "the DSH process never inherited WHALECLOUD_API_KEY" from a
  // hard failure into a lookup in the credential store.
  const apiKeyOverrides: Record<string, string> = {}
  for (const name of listCredentialReferences(request.cwd)) {
    const value = await resolveApiKey(name)
    if (value !== undefined && value.length > 0) apiKeyOverrides[name] = value
  }
  const cfg = loadDelphiConfig(request.cwd, process.env, undefined, apiKeyOverrides)
  const options = toDelphiOptions(cfg)
  return {
    options: { ...options, maxRounds: request.maxRounds ?? cfg.maxRounds },
    provider: cfg.provider,
    described: cfg.seats.map((s) => s.model).join(", "),
    cfg,
  }
}

/**
 * Resolve a settings-supplied `api_key` expression to a usable token.
 *
 * Accepts the same two placeholder spellings the JSON loader accepts. A literal
 * value is rejected rather than used: a bearer token typed into a settings field is
 * a credential written to a profile file in plain text.
 */
async function resolveExpressionKey(expression: string, resolveApiKey: ApiKeyResolver): Promise<string> {
  const placeholder = findPlaceholderName(expression)
  if (placeholder === undefined) {
    if (expression.trim() !== "") {
      throw new DelphiSetupError(
        "The Delphi settings hold a literal api key. Use a credential reference instead, " +
          'e.g. "${WHALECLOUD_API_KEY}", so the token never lands in the profile file.',
      )
    }
    throw new DelphiSetupError('The Delphi settings have no api key. Set it to "${YOUR_KEY_VAR}".')
  }
  const fromStore = await resolveApiKey(placeholder)
  if (fromStore !== undefined && fromStore.length > 0) return fromStore
  const fromEnv = expandEnvDetailed(expression, process.env)
  if (fromEnv.value.trim() !== "") return fromEnv.value
  throw new DelphiSetupError(
    `API key variable ${placeholder} has no value. Set it, or store it in DSH's credential store.`,
  )
}

/** The first `${VAR}` / `{env:VAR}` name in a config value, or undefined. */
function findPlaceholderName(value: string): string | undefined {
  const shell = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(value)
  if (shell) return shell[1]
  const envStyle = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/.exec(value)
  return envStyle ? envStyle[1] : undefined
}

async function runDelphiReview(subject: string, request: ReviewRequest): Promise<string> {
  const { addressed, cwd, resolveApiKey, signal, writeEvidence } = request
  try {
    const { options, provider, described, cfg } = await reviewOptions(request, resolveApiKey)
    const outcome = await runReview(options, subject, addressed, signal)
    const suffix = writeEvidence && cfg !== undefined
      ? await writeWalkthroughEvidence(cwd, cfg, outcome)
      : ""
    return `${formatOutcome(outcome)}\n\nProvider: ${provider}\nSeats: ${described}${suffix}`
  } catch (e) {
    // Config problems are the common failure; report them as guidance
    // rather than a stack trace.
    if (e instanceof DelphiSetupError) return `Delphi review not started: ${e.message}`
    if (e instanceof DelphiConfigError) return `Delphi review not started: ${e.message}`
    throw e
  }
}

function delphiReviewTool(resolveApiKey: ApiKeyResolver, settings: DelphiSettingsLayer | undefined) {
  return defineTool({
    name: "delphi-review",
    description:
      "Run a Delphi cross-review of a subject (a diff, a design, a spec) using three DISTINCT models from an external OpenAI-compatible provider. The seats come from the plugin's settings page (Plugins -> xp-gate -> Configure) when it holds any, otherwise from .delphi-config.json. Round 1 is anonymous and concurrent; later rounds feed back the aggregate until the approval ratio reaches the configured threshold (default 90%) or the round cap (default 5). Use this whenever a change needs independent multi-model review rather than a single model's opinion.",
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
      writeEvidence: {
        type: "boolean",
        description:
          "Write .code-walkthrough-result.json for the Gate MW pre-push check. Off by default because it is a file side effect; requires an APPROVED review.",
      },
    },
    output: {
      schema: { type: "string" },
      render: renderText,
    },
    timeoutMs: DELPHI_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = args.cwd ?? exec.agent?.session?.header?.cwd ?? process.cwd()
      return runDelphiReview(args.subject, {
        addressed: args.addressed ?? "",
        maxRounds: args.maxRounds,
        cwd,
        resolveApiKey,
        signal: exec.signal,
        writeEvidence: args.writeEvidence ?? false,
        settings,
      })
    },
  })
}

/**
 * Sprint-flow state commands.
 *
 * The sprint-flow skill tells the model to run these by name; without a tool the
 * instruction was unfollowable. Deliberately narrow: the subcommand and the
 * phase-transition status are enumerated, and paths are quoted, so this does not
 * become a passthrough to the whole CLI.
 */
function sprintTool(shell: Context["shell"], dialect: ShellDialect) {
  return defineTool({
    name: "sprint",
    description:
      "Inspect and advance XP-Gate Sprint Flow state: sprint-status, phase-transition, retro, ui-review, sprint-init, sprint-audit, next-sprint.",
    parameters: {
      subcommand: {
        type: "string",
        required: true,
        description: `One of: ${SPRINT_SUBCOMMANDS.join(", ")}.`,
        // Enumerated rather than free text: the schema rejects anything else before
        // the value could ever reach a shell.
        enum: SPRINT_SUBCOMMANDS.slice(),
      },
      phase: { type: "string", description: "phase-transition only: phase number, 1-6." },
      status: {
        type: "string",
        description: "phase-transition only: phase status.",
        enum: PHASE_STATUSES.slice(),
      },
      dir: { type: "string", description: "Project directory (absolute or relative)." },
      json: { type: "boolean", description: "Request JSON output where supported." },
      days: { type: "number", description: "retro only: days to look back." },
      all: { type: "boolean", description: "retro only: cover every sprint." },
    },
    output: {
      schema: { type: "string" },
      render: renderText,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const command = buildSprintCommand(args.subcommand, args, dialect)
      return runXpGate(shell, exec.signal, command, cwd, DEFAULT_TIMEOUT_MS)
    },
  })
}

/** Plugin configuration. */
interface XpGatePluginConfig {
  /** Save-time principles check: auto = source files, once each; off = no hook. */
  readonly principlesCheck: "auto" | "off"
  /** Sprint write guard: auto = deny until APPROVED; off = no hook. */
  readonly delphiGuard: "auto" | "off"
  /** Delphi seats edited on the Plugins page; empty means "use .delphi-config.json". */
  readonly delphi: DelphiSettingsLayer | undefined
}

/**
 * One Delphi seat, as the settings page stores it.
 *
 * `model` is a free string rather than an enum: the catalog the page offers comes
 * from the Host's configured providers, which this schema cannot enumerate, and a
 * model id that is not in the catalog yet must still be accepted so an operator can
 * pin a gateway alias. The invariants that matter are checked by
 * `seatsFromSettings` on every run, not by the schema.
 */
const DelphiSeatSchema = z.object({
  role: z.string().default(""),
  model: z.string().default("").description("Model id sent to the gateway, e.g. g-glm-5.3-flash."),
  maxTokens: z.number().min(0).description("Per-seat token budget; raise it for reasoning models."),
})

/**
 * Runtime schema for the keys above.
 *
 * Exported as a schema, not just a type: DSH validates against it and surfaces the
 * keys in the profile schema, so a user can discover and set them. A bare interface
 * is invisible to the harness.
 *
 * The `delphi` block is `.volatile()`: the settings page edits it live, and DSH
 * refuses to write a path that is not beneath a volatile node. The two hook
 * switches stay ordinary fields — they are read at mount and remounting a hook is
 * what "off" is supposed to require.
 */
export const Config = z.object({
  principlesCheck: z
    .union([z.const("auto"), z.const("off")])
    .default("auto")
    .description(
      "Save-time principles check: auto = on for source files, once per file; off = do not register the hook.",
    ),
  delphiGuard: z
    .union([z.const("auto"), z.const("off")])
    .default("auto")
    .description(
      "Sprint write guard: auto = deny edits until delphi-review is APPROVED; off = do not register the hook.",
    ),
  delphi: z
    .object({
      baseUrl: z.string().default("").description("OpenAI-compatible gateway, e.g. https://host/gpt-proxy."),
      apiKey: z
        .string()
        .default("")
        .description("Credential reference such as ${WHALECLOUD_API_KEY}; never a literal key."),
      seats: z.array(DelphiSeatSchema).default([]).description("The three Delphi reviewers."),
      thresholdPercent: z.number().min(0).max(100).description("Approval bar; 3 seats at 90% means 3/3."),
      maxRounds: z.number().min(1).max(20).description("Round cap before the review reports NO CONSENSUS."),
    })
    .volatile()
    .description(
      "Delphi seats edited on the Plugins page. Leave seats empty to use .delphi-config.json.",
    ),
})

export function apply(ctx: Context, config: unknown = {}): void {
  const cfg = config as Partial<XpGatePluginConfig>
  const shell = ctx.shell
  // The EXECUTOR decides the dialect, not the platform (#669). "win32 implies
  // PowerShell" stopped being true once Windows could mount a Git Bash executor:
  // a PowerShell command string handed to bash exits 127 on a line that does not
  // parse, so every gate was reported as failed. Falls back to the platform
  // default when the executor does not reveal itself.
  const dialect = detectDialectForShell(shell)
  // ctx.credentials is optional: outside DSH there is no store, and the resolver
  // then reads the process environment directly. Inside DSH this is what makes
  // delphi-review work on a machine whose key lives in the credential store rather
  // than in the host process's inherited environment.
  //
  // The cast is needed because the service is attached by a peer package's module
  // augmentation, which only applies when that package is in the compilation; a
  // consumer may install this plugin without it.
  const credentials = (ctx as unknown as { credentials?: CredentialProvider }).credentials
  const resolveApiKey = createCredentialResolver(credentials, process.env)
  ctx.tools.register(gateCheckTool(shell, dialect))
  ctx.tools.register(gatePrinciplesTool(shell, dialect))
  ctx.tools.register(gateArchTool(shell, dialect))
  ctx.tools.register(delphiReviewTool(resolveApiKey, cfg.delphi))
  ctx.tools.register(sprintTool(shell, dialect))

  // Publishing the 12 bundled skills is what makes them visible to the model.
  // They ship in the tarball either way, but without a provider no discovery
  // root points at the plugin directory and the model never sees them — the v1
  // bug this provider exists to fix.
  ctx.skills.registerProvider(() => createSkillProvider(bundledSkillsRoot()))

  registerHooks(ctx, shell, dialect, cfg)
}

/**
 * Attach the advisory principles result to an accepted tool result.
 *
 * Best effort by contract: a throwing post-execute fails the tool call, which is a
 * much worse outcome than skipping one advisory check, so nothing here propagates.
 */
async function enrichWithPrinciples(
  shell: Context["shell"],
  dialect: ShellDialect,
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
): Promise<PostToolDecision> {
  try {
    const note = await principlesNote(shell, dialect, exec, result)
    if (note === undefined) return next()
    const accepted = await next()
    if (accepted.kind !== "accept" || accepted.value !== undefined) return accepted
    // Appended to the tool's own output rather than as a separate message: the model
    // reads it immediately, with no dependency on message identity.
    return {
      ...accepted,
      content: [...(accepted.content ?? []), { type: "text" as const, text: note }],
    }
  } catch {
    return next()
  }
}

/**
 * Register the pre/post-execute hooks.
 *
 * Both default to on and are individually switchable, because each is a policy a
 * repository may reasonably reject: the guard blocks writes, and the save check
 * costs a subprocess per file.
 */
function registerHooks(
  ctx: Context,
  shell: Context["shell"],
  dialect: ShellDialect,
  cfg: Partial<XpGatePluginConfig>,
): void {
  if (cfg.delphiGuard !== "off") {
    ctx.on("tools/pre-execute", async (exec, next) => {
      const cwd = sessionCwd(exec) ?? process.cwd()
      // Deny before dispatch so the edit never reaches the filesystem.
      return delphiGuardDecision(cwd, exec.name) ?? next()
    })
  }
  if (cfg.principlesCheck !== "off") {
    ctx.on("tools/post-execute", (exec, result, next) =>
      enrichWithPrinciples(shell, dialect, exec, result, next),
    )
  }
}

/** The session cwd, if the execution carries one. */
function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined {
  return exec.agent?.session?.header?.cwd
}

/**
 * Advisory principles result for a just-written file, or undefined to stay silent.
 *
 * Cost is the whole design here. `xp-gate principles` is a Node CLI with a
 * 200-400ms cold start, and an editing session makes dozens of edits, so two
 * filters cut nearly all of the calls:
 *
 *  - extension allowlist: the engine covers source files, not .md/.json/.yaml,
 *    which are a large share of the edits in repositories that use xp-gate
 *  - per-process dedupe: the model often edits the same file ten times in a row, and
 *    those later edits are it fixing what the first check reported
 *
 * Anything unexpected returns undefined. Blocking the tool call to report an
 * advisory violation would be far worse than missing the report.
 */
async function principlesNote(
  shell: Context["shell"],
  dialect: ShellDialect,
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
): Promise<string | undefined> {
  if (!isEditTool(exec.name) || result.isError) return undefined
  const path = writtenPath(exec.arguments)
  if (path === undefined || !isCheckablePath(path)) return undefined

  const cwd = sessionCwd(exec) ?? process.cwd()
  const absolute = resolveTarget(path, cwd)
  if (checkedThisSession.has(absolute)) return undefined
  checkedThisSession.add(absolute)

  try {
    // No caller signal reaches a post-execute hook; the hook's own ceiling is enough,
    // and it is the shell that enforces it.
    const report = await runXpGate(
      shell,
      AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      buildCommand({ subcommand: "principles", target: absolute, dialect }),
      cwd,
      DEFAULT_TIMEOUT_MS,
    )
    return `[XP-Gate] principles for ${path}:\n${report}`
  } catch {
    return undefined
  }
}

/**
 * The file a write/edit touched.
 *
 * Both shapes appear across DSH's file tools, so both are read rather than assuming
 * one: `file_path` from the fs tools, `path` from str-replace-editor.
 */
function writtenPath(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const record = args as { file_path?: unknown; path?: unknown }
  const candidate = record.file_path ?? record.path
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
}
