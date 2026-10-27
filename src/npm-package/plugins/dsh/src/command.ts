import { isAbsolute, resolve } from "node:path"
import { type ShellDialect, shellQuote } from "./dialect.js"

// Re-exported so existing importers of this module keep working; the dialect
// primitives themselves live in ./dialect.ts.
export { type ShellDialect, detectDialect, shellQuote, shq } from "./dialect.js"

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
  // subcommand === "arch" — the only remaining member of the union.
  // #447: the default path runs the pinned local @archlinter/cli with its
  // built-in rules — no config needed. Forcing `--config architecture.yaml`
  // (the old default) hit the pre-0.16 schema that archlint itself rejects.
  // Only forward an explicitly provided config, via the opt-in --use-config.
  const tokens = ["xp-gate", "arch"]
  if (config !== undefined) tokens.push("--use-config", q(config))
  return tokens.join(" ")
}

/**
 * Build a single unconditional shell command.
 *
 * There is deliberately no presence probe. An earlier version wrapped the call
 * in `if command -v xp-gate …; then …; else print hint; fi`, which left the exit
 * code at 0 on the else branch — so a CLI that resolved but then failed produced
 * empty stdout with exit 0, and the model read that as a pass.
 *
 * Running unconditionally turns "not installed" into an ordinary command-not-found
 * (nonzero exit, empty output), which renderGateResult classifies as
 * INDETERMINATE and pairs with an install hint. It also removes the branch that
 * could not distinguish "absent" from "present but broken".
 */
export function buildCommand(options: BuildCommandOptions): string {
  const dialect = options.dialect ?? "posix"
  const inner = buildInner(options, dialect)
  if (dialect === "posix") {
    // Merge stderr into stdout so a failure that only writes to stderr still
    // reaches the renderer, then echo the status so the exit code survives the
    // pipeline.
    return `${inner} 2>&1; printf '\\n[XP-Gate] exit:%s\\n' "$?"`
  }
  // PowerShell: merge streams and report $LASTEXITCODE explicitly. The
  // .cmd/.ps1 shims npm writes under %APPDATA%\npm are visible here but not to a
  // Git-Bash PATH lookup, which is why Windows uses this dialect.
  return `${inner} 2>&1; Write-Output "[XP-Gate] exit:$LASTEXITCODE"`
}

/** Resolve a model-supplied path against the session cwd; absolutes pass through. */
export function resolveTarget(rawPath: string, cwd: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
}
