/**
 * Shell dialect selection and quoting.
 *
 * DSH chooses its shell backend per platform: `dsh-base` disables
 * `bash-sandbox`/`tool-bash` and enables `pwsh-sandbox`/`tool-pwsh` on win32.
 * A command string written for the wrong dialect fails to parse, so callers
 * must pick the dialect to match the executor rather than assume POSIX.
 */

export type ShellDialect = "posix" | "powershell"

/** Quote one argument for the target dialect. */
export function shellQuote(value: string, dialect: ShellDialect): string {
  if (dialect === "posix") {
    // POSIX single-quote escaping: `'` becomes `'\''`.
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  // PowerShell single-quoted strings escape an embedded quote by doubling it.
  // Backticks and `$(…)` are literal inside single quotes, so no further
  // escaping is needed to keep them inert.
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * POSIX single-quote shell escaping: `'` becomes `'\''`.
 * @deprecated Use {@link shellQuote} with an explicit dialect.
 */
export function shq(value: string): string {
  return shellQuote(value, "posix")
}

/**
 * Pick the dialect for the current platform.
 *
 * `process.platform` is the reliable signal available inside a tool body; it
 * mirrors exactly where DSH enables each sandbox/executor pair.
 */
export function detectDialect(platform: NodeJS.Platform = process.platform): ShellDialect {
  return platform === "win32" ? "powershell" : "posix"
}
