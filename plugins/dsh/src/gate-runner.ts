import { TOOL_ABORTED } from "@deepseek-ai/dsh-tools"
import { HarnessError } from "@deepseek-ai/dsh-llm"
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from "@deepseek-ai/dsh-shell"

/**
 * Structural view of `ctx.shell` so the runner is testable with a fake shell
 * without importing the abstract `ShellExecutor` service.
 *
 * The shape tracks the 0.2.0-rc.2 seam: `execute()` returns a handle whose
 * `result()` settles into the run result. Earlier 0.1.x exposed a single `run()`,
 * which is why a stale devDependency made this compile while the real runtime
 * had already moved on.
 */
export interface XpGateShell {
  resolve(request: ShellExecRequest): ShellExecSpec
  execute(spec: ShellExecSpec): Promise<{ result(): Promise<ShellRunResult> }>
}

/** The three verdicts a gate run can produce. There is deliberately no fourth. */
export type GateVerdict = "PASS" | "GATE FAILED" | "INDETERMINATE"

/**
 * Classify a completed shell run.
 *
 * The order below is load-bearing and must not be rearranged:
 *
 *   1. timeout / truncation  -> INDETERMINATE (a killed or clipped run yields no verdict)
 *   2. exit 0 with no stdout -> INDETERMINATE (the command succeeded but said nothing)
 *   3. exit 0 with stdout    -> PASS
 *   4. otherwise             -> GATE FAILED  (nonzero with output) or INDETERMINATE (silent)
 *
 * Step 1 must precede step 3: a timed-out process can still report exit 0 from
 * the state it held when the deadline killed it, so testing `exitCode === 0`
 * first would render a timeout as a pass. That is the exact defect this project
 * fixed in Gate 8 and Gate 10, and the plugin must not reintroduce it.
 */
export function classifyGateRun(result: ShellRunResult): GateVerdict {
  const stdout = result.stdout.text.trim()

  if (result.timedOut) return "INDETERMINATE"
  if (result.stdout.truncated) return "INDETERMINATE"
  if (result.exitCode === 0) return stdout.length > 0 ? "PASS" : "INDETERMINATE"

  // Nonzero: a verdict exists only when the run produced something to show.
  const stderr = result.stderr.text.trim()
  return stdout.length > 0 || stderr.length > 0 ? "GATE FAILED" : "INDETERMINATE"
}

/** Detailed diagnostics appended after the verdict line, when present. */
function renderDetails(result: ShellRunResult): string[] {
  const lines: string[] = []
  const stdout = result.stdout.text.trim()
  if (stdout.length > 0) lines.push(stdout)
  const stderr = result.stderr.text.trim()
  if (stderr.length > 0) lines.push(`[stderr] ${stderr}`)
  if (result.timedOut) lines.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.exitCode !== null && result.exitCode !== 0) lines.push(`[exit code: ${result.exitCode}]`)
  if (result.signal !== null) lines.push(`[signal: ${result.signal}]`)
  if (result.sandbox?.denied === true) {
    lines.push(`[sandbox: file access denied under ${result.sandbox.mode} mode]`)
  }
  if (result.stdout.truncated) {
    const spill = result.stdout.spillPath !== undefined ? `, full output: ${result.stdout.spillPath}` : ""
    lines.push(`[stdout truncated${spill}]`)
  }
  if (result.stderr.truncated) {
    const spill = result.stderr.spillPath !== undefined ? `, full output: ${result.stderr.spillPath}` : ""
    lines.push(`[stderr truncated${spill}]`)
  }
  return lines
}

/** Install hint appended whenever no verdict could be reached. */
const INDETERMINATE_HINT =
  "The gate produced no usable verdict. Check that the xp-gate CLI is installed " +
  "and runnable (npm i -g @boyingliu01/xp-gate), then retry."

/**
 * Render a completed shell run as model-facing text.
 *
 * Every run resolves to exactly one of three verdicts. A run that could not
 * establish a verdict says INDETERMINATE and states explicitly that it is not a
 * pass, because an empty output read as a green check is worse than no output.
 */
export function renderGateResult(result: ShellRunResult): string {
  const verdict = classifyGateRun(result)
  const lines = renderDetails(result)

  if (verdict === "PASS") {
    return `[XP-Gate] PASS\n${lines.join("\n")}`
  }
  if (verdict === "GATE FAILED") {
    return `[XP-Gate] GATE FAILED\n${lines.join("\n")}`
  }
  return [`[XP-Gate] INDETERMINATE — gate produced no output; NOT a pass`, ...lines, INDETERMINATE_HINT].join(
    "\n",
  )
}

/**
 * Run an xp-gate command through the harness shell seam. Nonzero exits, timeouts,
 * and sandbox denials resolve (and render) rather than reject; only cancellation
 * (the caller's AbortSignal fired first) throws an AbortError with code ABORTED.
 */
export async function runXpGate(
  shell: XpGateShell,
  signal: AbortSignal,
  command: string,
  workdir: string,
  timeoutMs: number,
): Promise<string> {
  const spec = shell.resolve({ command, workdir, timeoutMs, signal })
  const execution = await shell.execute(spec)
  const result = await execution.result()
  if (result.aborted) {
    const error = new HarnessError("tool call aborted", TOOL_ABORTED)
    error.name = "AbortError"
    throw error
  }
  return renderGateResult(result)
}