/**
 * @test REQ-DSH-011 tri-state gate rendering
 * @intent Verify renderGateResult classifies every shell outcome into exactly one of
 *         PASS / GATE FAILED / INDETERMINATE, following the documented decision order,
 *         and that no ambiguous outcome can be read as a pass.
 * @covers AC-DSH-011-01 AC-DSH-011-02 AC-DSH-011-03 AC-DSH-011-04 AC-DSH-011-05 AC-DSH-011-06
 *
 * Why the ordering matters: a timed-out process can still report exit 0 from its
 * last state before the kill, so checking `exit === 0` first would turn a timeout
 * into a green check. The same mistake in Gate 8 and Gate 10 is exactly what this
 * project kept re-fixing — a gate that could not run must never report success.
 */

import { describe, it, expect } from "vitest"
import type { ShellRunResult } from "@deepseek-ai/dsh-shell"
import { renderGateResult } from "./gate-runner.js"

function makeResult(over: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    exitCode: 0,
    stdout: { text: "", truncated: false },
    stderr: { text: "", truncated: false },
    timedOut: false,
    timeoutMs: 1000,
    signal: null,
    aborted: false,
    ...over,
  } as ShellRunResult
}

describe("renderGateResult tri-state", () => {
  it("reports PASS on exit 0 with non-empty stdout", () => {
    const out = renderGateResult(makeResult({ stdout: { text: "all gates ok", truncated: false } }))
    expect(out).toContain("[XP-Gate] PASS")
    expect(out).toContain("all gates ok")
    expect(out).not.toContain("INDETERMINATE")
    expect(out).not.toContain("GATE FAILED")
  })

  it("reports INDETERMINATE on exit 0 with empty stdout", () => {
    // The command succeeded but said nothing — that is not a pass.
    const out = renderGateResult(makeResult({ stdout: { text: "   \n", truncated: false } }))
    expect(out).toContain("INDETERMINATE")
    expect(out).toContain("NOT a pass")
    expect(out).not.toContain("[XP-Gate] PASS")
  })

  it("reports GATE FAILED on nonzero exit with output", () => {
    const out = renderGateResult(
      makeResult({
        exitCode: 3,
        stdout: { text: "3 violations found", truncated: false },
      }),
    )
    expect(out).toContain("GATE FAILED")
    expect(out).toContain("exit code: 3")
    expect(out).toContain("3 violations found")
    expect(out).not.toContain("INDETERMINATE")
  })

  it("reports GATE FAILED on nonzero exit with only stderr", () => {
    const out = renderGateResult(
      makeResult({
        exitCode: 1,
        stderr: { text: "adapter crashed", truncated: false },
      }),
    )
    expect(out).toContain("GATE FAILED")
    expect(out).toContain("adapter crashed")
  })

  it("reports INDETERMINATE on nonzero exit with no output at all", () => {
    // Typical command-not-found: neither a verdict nor a reason.
    const out = renderGateResult(makeResult({ exitCode: 127 }))
    expect(out).toContain("INDETERMINATE")
    expect(out).not.toContain("GATE FAILED")
    expect(out).not.toContain("[XP-Gate] PASS")
  })

  it("reports INDETERMINATE on timeout even when exit code is 0", () => {
    // The ordering trap: exit 0 must not win over timedOut.
    const out = renderGateResult(
      makeResult({
        exitCode: 0,
        timedOut: true,
        stdout: { text: "partial output", truncated: false },
      }),
    )
    expect(out).toContain("INDETERMINATE")
    expect(out).toContain("timed out")
    expect(out).not.toContain("[XP-Gate] PASS")
  })

  it("reports INDETERMINATE when stdout was truncated", () => {
    const out = renderGateResult(
      makeResult({
        stdout: { text: "head of the report", truncated: true, spillPath: "/tmp/spill.log" },
      }),
    )
    expect(out).toContain("INDETERMINATE")
    expect(out).not.toContain("[XP-Gate] PASS")
  })

  it("never emits PASS anywhere in an ambiguous result", () => {
    const ambiguous = [
      makeResult({ exitCode: 0 }),
      makeResult({ exitCode: 127 }),
      makeResult({ timedOut: true, exitCode: 0 }),
      makeResult({ stdout: { text: "", truncated: true } }),
    ]
    for (const result of ambiguous) {
      const out = renderGateResult(result)
      // "NOT a pass" is allowed; a bare verdict line is not.
      expect(out).not.toMatch(/\[XP-Gate\]\s+PASS/)
    }
  })
})
