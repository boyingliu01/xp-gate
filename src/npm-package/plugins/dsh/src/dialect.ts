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
 * @deprecated Platform is NOT the right signal (#669). It encodes the assumption
 * "win32 => PowerShell executor", which held when this was written but is now
 * false: Windows can mount a Git Bash executor, and a PowerShell command string
 * handed to bash fails to parse. Use {@link detectDialectForShell} wherever a
 * shell is available; this remains only as the last-resort fallback.
 */
export function detectDialect(platform: NodeJS.Platform = process.platform): ShellDialect {
  return platform === "win32" ? "powershell" : "posix"
}

/** Structural view of a shell executor — only the fields that reveal its dialect. */
export interface DialectBearingShell {
  /** Explicit dialect/kind announcement, when the executor offers one. */
  shellDialect?: unknown
  dialect?: unknown
  /** Absolute path to the resolved bash binary — the Git Bash executor's tell. */
  bashPath?: unknown
}

function announceDialect(shell: DialectBearingShell): ShellDialect | null {
  for (const raw of [shell.shellDialect, shell.dialect]) {
    if (typeof raw !== "string") continue
    const lower = raw.toLowerCase()
    if (lower.includes("bash") || lower.includes("posix")) return "posix"
    if (lower.includes("pwsh") || lower.includes("powershell")) return "powershell"
  }
  return null
}

/**
 * Pick the dialect from the executor that will actually run the command (#669).
 *
 * Detection is structural — an explicit announcement, or a resolved `bashPath` —
 * never a class name, so this stays decoupled from any particular executor
 * package. When nothing is recognisable it falls back to the platform default,
 * which equals the old behaviour and is therefore never worse.
 */
export function detectDialectForShell(
  shell?: unknown,
  platform: NodeJS.Platform = process.platform,
): ShellDialect {
  const fallback = detectDialect(platform)
  if (shell === null || typeof shell !== "object") return fallback
  const view = shell as DialectBearingShell
  const announced = announceDialect(view)
  if (announced !== null) return announced
  if (typeof view.bashPath === "string" && view.bashPath.length > 0) return "posix"
  return fallback
}
