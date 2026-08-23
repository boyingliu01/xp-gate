import { isAbsolute, resolve } from "node:path"

/** Shown when the global `xp-gate` CLI is not on PATH. */
export const FALLBACK_MESSAGE =
  "[XP-Gate] xp-gate CLI not installed. Install it with: npm install -g @boyingliu01/xp-gate"

/**
 * Allowlist of xp-gate gate aliases that are safe to invoke standalone
 * (non-preCommitOnly gates + common aliases). Anything outside this set is
 * rejected before reaching the shell.
 */
export const GATE_WHITELIST = [
  "duplicates",
  "complexity",
  "principles",
  "arch",
  "architecture",
  "iac",
  "secrets",
  "sast",
] as const

export type GateId = (typeof GATE_WHITELIST)[number]

/** POSIX single-quote shell escaping: `'` becomes `'\''`. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function isGateAllowed(gate: string): boolean {
  return (GATE_WHITELIST as readonly string[]).includes(gate)
}

export interface BuildCommandOptions {
  subcommand: "check" | "principles" | "arch"
  target?: string
  gates?: readonly string[]
  config?: string
}

function buildInner(options: BuildCommandOptions): string {
  const { subcommand, target, gates, config } = options
  if (subcommand === "check") {
    const tokens = ["xp-gate", "check"]
    if (target !== undefined) tokens.push(shq(target))
    if (gates !== undefined && gates.length > 0) tokens.push("--gates", shq(gates.join(",")))
    return tokens.join(" ")
  }
  if (subcommand === "principles") {
    const tokens = ["xp-gate", "principles"]
    if (target !== undefined) tokens.push(shq(target))
    return tokens.join(" ")
  }
  return ["xp-gate", "arch", "--config", shq(config ?? "architecture.yaml")].join(" ")
}

/**
 * Build a single guarded shell command: runs `xp-gate …` when the global CLI
 * is present, otherwise prints the graceful-degradation hint. A single
 * `if command -v` avoids a separate probe/run race.
 */
export function buildCommand(options: BuildCommandOptions): string {
  const inner = buildInner(options)
  return `if command -v xp-gate >/dev/null 2>&1; then ${inner}; else printf '%s\\n' ${shq(FALLBACK_MESSAGE)}; fi`
}

/** Resolve a model-supplied path against the session cwd; absolutes pass through. */
export function resolveTarget(rawPath: string, cwd: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
}