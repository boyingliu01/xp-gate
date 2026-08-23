import { TOOL_ABORTED } from "@deepseek-ai/dsh-tools"
import { HarnessError } from "@deepseek-ai/dsh-llm"
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from "@deepseek-ai/dsh-shell"

/**
 * Structural view of `ctx.shell` so the runner is testable with a fake shell
 * without importing the abstract `ShellExecutor` service.
 */
export interface XpGateShell {
  resolve(request: ShellExecRequest): ShellExecSpec
  run(spec: ShellExecSpec): Promise<ShellRunResult>
}

/** Render a completed shell run as a single model-facing text block. */
export function renderGateResult(result: ShellRunResult): string {
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
  return lines.length > 0 ? lines.join("\n") : "[XP-Gate] command completed (no output)."
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
  const result = await shell.run(spec)
  if (result.aborted) {
    const error = new HarnessError("tool call aborted", TOOL_ABORTED)
    error.name = "AbortError"
    throw error
  }
  return renderGateResult(result)
}