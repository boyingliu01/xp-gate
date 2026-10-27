/**
 * Sprint-flow subcommands the model may run.
 *
 * @test REQ-DSH-013 sprint-flow subcommands are callable from the model
 * @intent Expose the sprint state commands the sprint-flow skill instructs the model
 *         to run, without opening a passthrough to the whole CLI.
 * @covers AC-DSH-013-01
 *
 * The skill references these commands by name, so before this module existed a model
 * following the skill could read the instruction and had no way to carry it out.
 *
 * The whitelist is the security boundary, not a convenience: a passthrough tool would
 * turn one tool call into arbitrary CLI invocation, which is a far larger surface than
 * the four gate tools it sits beside. Enumerating both the subcommand and the
 * phase-transition status keeps every user-influenced token inside a known set.
 */

import { type ShellDialect, shellQuote } from "./dialect.js"

/**
 * Subcommands in scope. Deliberately excludes anything destructive or
 * environment-mutating (`uninstall`, `init`, `migrate`, `setup-global`) even though
 * they are the same CLI.
 */
export const SPRINT_SUBCOMMANDS = [
  "sprint-status",
  "phase-transition",
  "retro",
  "ui-review",
  "sprint-init",
  "sprint-audit",
  "next-sprint",
] as const

export type SprintSubcommand = (typeof SPRINT_SUBCOMMANDS)[number]

/** The only status values `phase-transition` documents. */
export const PHASE_STATUSES = ["in_progress", "completed", "skipped", "failed", "paused"] as const

export type PhaseStatus = (typeof PHASE_STATUSES)[number]

/** Options a caller may pass. Every field is either enumerated or quoted. */
export interface SprintCommandOptions {
  /** phase-transition phase number, 1-6. */
  readonly phase?: string
  /** phase-transition status. */
  readonly status?: string
  /** Project directory, quoted as a single argument. */
  readonly dir?: string
  /** Emit JSON where the subcommand supports it. */
  readonly json?: boolean
  /** `retro`: look back N days. */
  readonly days?: number
  /** `retro`: cover every sprint. */
  readonly all?: boolean
}

/** Phase numbers the CLI accepts. */
const PHASE_NUMBERS: readonly string[] = ["1", "2", "3", "4", "5", "6"]

/** Type guard for the subcommand whitelist. */
export function isSprintSubcommand(value: string): boolean {
  return (SPRINT_SUBCOMMANDS as readonly string[]).includes(value)
}

/**
 * Validate a subcommand, throwing rather than returning a sentinel.
 *
 * A caller that ignores a boolean would fall through to "run nothing" or, worse, to a
 * default subcommand; throwing makes the rejection impossible to overlook.
 */
export function assertSprintSubcommand(value: string): asserts value is SprintSubcommand {
  if (!isSprintSubcommand(value)) {
    throw new Error(
      `Unknown sprint subcommand "${value}". Allowed: ${SPRINT_SUBCOMMANDS.join(", ")}`,
    )
  }
}

/** Validate the two positional arguments phase-transition requires. */
function phaseTokens(options: SprintCommandOptions): string[] {
  const phase = options.phase ?? ""
  if (!PHASE_NUMBERS.includes(phase)) {
    throw new Error(`phase must be one of ${PHASE_NUMBERS.join(", ")}; got "${phase}"`)
  }
  const status = options.status ?? ""
  if (!(PHASE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`status must be one of ${PHASE_STATUSES.join(", ")}; got "${status}"`)
  }
  return [phase, status]
}

/** Append the flags shared by several subcommands. */
function sharedFlags(options: SprintCommandOptions, dialect: ShellDialect): string[] {
  const flags: string[] = []
  if (options.json) flags.push("--json")
  if (options.all) flags.push("--all")
  if (options.days !== undefined && Number.isInteger(options.days) && options.days > 0) {
    flags.push("--days", String(options.days))
  }
  if (options.dir !== undefined) flags.push("--dir", shellQuote(options.dir, dialect))
  return flags
}

/**
 * Build the command line for a whitelisted subcommand.
 *
 * User-influenced values reach the shell in exactly two ways: enumerated membership
 * (subcommand, phase, status) or shell quoting (paths). Nothing is interpolated raw,
 * which is what keeps this from becoming the injection surface a passthrough would be.
 */
export function buildSprintCommand(
  subcommand: string,
  options: SprintCommandOptions = {},
  dialect: ShellDialect = "posix",
): string {
  assertSprintSubcommand(subcommand)
  const tokens = ["xp-gate", subcommand]
  if (subcommand === "phase-transition") tokens.push(...phaseTokens(options))
  tokens.push(...sharedFlags(options, dialect))
  return tokens.join(" ")
}
