/**
 * @test REQ-DSH-007 cooperative cancellation reaches Delphi
 * @intent Verify an externally aborted signal stops a Delphi review and surfaces as
 *         TOOL_ABORTED, the same code the three gate tools already raise on cancel.
 * @covers AC-DSH-007-02
 *
 * Why this matters for cost as much as for correctness: a review is up to 5 rounds
 * across 3 seats under a 900s ceiling. Without signal plumbing, pressing Stop in the
 * GUI left every one of those requests running to completion — the user paid for a
 * review they had already abandoned.
 */

import { describe, it, expect } from "vitest"
import { TOOL_ABORTED } from "@deepseek-ai/dsh-tools"
import { runReview } from "./delphi-run.js"
import type { DelphiOptions } from "./delphi.js"

/** A fetch that never settles until the supplied signal aborts. */
function hangingFetch(signal: AbortSignal | null | undefined): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      const signalToWatch = init?.signal ?? signal
      if (signalToWatch?.aborted) return abort()
      signalToWatch?.addEventListener("abort", abort, { once: true })
      return undefined
    })) as unknown as typeof fetch
}

const options: DelphiOptions = {
  baseUrl: "https://gw.example/v1",
  apiKey: "test-key",
  seats: [
    { role: "architecture", model: "model-a" },
    { role: "technical", model: "model-b" },
    { role: "feasibility", model: "model-c" },
  ] as unknown as DelphiOptions["seats"],
  thresholdPercent: Number("90"),
  maxRounds: Number("5"),
}

describe("runReview cancellation", () => {
  it("raises TOOL_ABORTED when the caller's signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await runReview(
      { ...options, fetchImpl: hangingFetch(undefined) },
      "a diff",
      "",
      controller.signal,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    // The harness maps cancellation to this code; anything else reads as a failure.
    expect((error as { code?: string }).code).toBe(TOOL_ABORTED)
  })

  it("stops an in-flight review when the signal aborts mid-round", async () => {
    const controller = new AbortController()
    const pending = runReview(
      { ...options, fetchImpl: hangingFetch(undefined) },
      "a diff",
      "",
      controller.signal,
    ).catch((e: unknown) => e)
    // Abort after the request is in flight, not before.
    controller.abort()
    const error = await pending
    expect((error as { code?: string }).code).toBe(TOOL_ABORTED)
  })
})
