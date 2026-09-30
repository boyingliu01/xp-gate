import { isAbsolute, resolve } from "node:path"
import { type ShellDialect, shellQuote } from "./dialect.js"

// Re-exported so existing importers of this module keep working; the dialect
// primitives themselves live in ./dialect.ts.
export { type ShellDialect, detectDialect, shellQuote, shq } from "./dialect.js"

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

export function isGateAllowed(gate: string): boolean {
  return (GATE_WHITELIST as readonly string[]).includes(gate)
}

export interface BuildCommandOptions {
  subcommand: "check" | "principles" | "arch"
  target?: string
  gates?: readonly string[]
  config?: string
  /**
   * Executor dialect. Defaults to `"posix"` so existing callers keep working;
   * callers running under DSH on Windows must pass `"powershell"`.
   */
  dialect?: ShellDialect
}

function buildInner(options: BuildCommandOptions, dialect: ShellDialect): string {
  const { subcommand, target, gates, config } = options
  const q = (value: string) => shellQuote(value, dialect)
  if (subcommand === "check") {
    const tokens = ["xp-gate", "check"]
    if (target !== undefined) tokens.push(q(target))
    if (gates !== undefined && gates.length > 0) {
      // Defense-in-depth: the JSON-schema enum already rejects unknown gate ids,
      // but we also whitelist here so a non-whitelisted value can never reach the shell.
      const allowed = gates.filter(isGateAllowed)
      if (allowed.length > 0) tokens.push("--gates", q(allowed.join(",")))
    }
    return tokens.join(" ")
  }
  if (subcommand === "principles") {
    const tokens = ["xp-gate", "principles"]
    if (target !== undefined) tokens.push(q(target))
    return tokens.join(" ")
  }
  return ["xp-gate", "arch", "--config", q(config ?? "architecture.yaml")].join(" ")
}

/**
 * Build a single guarded shell command: runs `xp-gate …` when the global CLI
 * is present, otherwise prints the graceful-degradation hint. A single
 * presence check avoids a separate probe/run race.
 */
export function buildCommand(options: BuildCommandOptions): string {
  const dialect = options.dialect ?? "posix"
  const inner = buildInner(options, dialect)
  if (dialect === "posix") {
    return `if command -v xp-gate >/dev/null 2>&1; then ${inner}; else printf '%s\\n' ${shellQuote(
      FALLBACK_MESSAGE,
      dialect,
    )}; fi`
  }
  // PowerShell: `Get-Command` resolves the .cmd/.ps1 shims npm writes to
  // %APPDATA%\npm. Those shims are invisible to a Git-Bash PATH lookup, so this
  // branch is more reliable than `command -v` on Windows.
  //
  // The hint branch leaves $LASTEXITCODE untouched at 0, matching the POSIX
  // branch's `printf` behaviour.
  return `if (Get-Command xp-gate -ErrorAction SilentlyContinue) { ${inner} } else { Write-Output ${shellQuote(
    FALLBACK_MESSAGE,
    dialect,
  )} }`
}

/** Resolve a model-supplied path against the session cwd; absolutes pass through. */
export function resolveTarget(rawPath: string, cwd: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
}
