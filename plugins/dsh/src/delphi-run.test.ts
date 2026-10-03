import { describe, it, expect } from "vitest"
import { formatOutcome, runReview } from "./delphi-run.js"
import type { ExpertSeat } from "./delphi.js"

/**
 * @test REQ-DSH-016
 * @intent 验证多轮编排的收敛语义：首轮匿名、达阈值即停、未达阈值继续、
 *         触及轮次上限则如实返回 NO CONSENSUS；并验证一份畸形报告
 *         无法靠其余全票凑出共识（分母是全体席位）。
 * @covers AC-DSH-016-03
 */

const seats: ExpertSeat[] = [
  { id: "A", role: "architecture", model: "m-a" },
  { id: "B", role: "technical", model: "m-b" },
  { id: "C", role: "feasibility", model: "m-c" },
]

/**
 * Fetch stub that answers per (model, call index). `plan[n]` is the verdict map
 * used on the n-th round, so a sequence of rounds can be scripted.
 */
function scriptedFetch(plan: Array<Record<string, string>>) {
  let round = 0
  let seen = 0
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model as string
    // Three seats per round, collected in seat order.
    const idx = round
    const table = plan[Math.min(idx, plan.length - 1)]
    seen += 1
    if (seen % 3 === 0) round += 1
    const body = table[model]
    if (body === undefined) return new Response("nope", { status: 404 })
    return new Response(
      JSON.stringify({
        model: `resolved-${model}`,
        choices: [{ finish_reason: "stop", message: { content: body } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }) as unknown as typeof fetch
}

const APPROVE = "### VERDICT\nAPPROVED\n### CONFIDENCE\n8"
const REJECT = "### VERDICT\nREQUEST_CHANGES\n### CONFIDENCE\n7"

describe("runReview", () => {
  it("stops at round 1 when the whole panel approves", async () => {
    const out = await runReview(
      {
        baseUrl: "https://x.test/gw",
        apiKey: "k",
        seats,
        fetchImpl: scriptedFetch([{ "m-a": APPROVE, "m-b": APPROVE, "m-c": APPROVE }]),
      },
      "subject",
    )
    expect(out.consensus).toBe(true)
    expect(out.totalRounds).toBe(1)
    expect(out.finalRatio).toBe(1)
  })

  it("iterates when the first round disagrees, then converges", async () => {
    const out = await runReview(
      {
        baseUrl: "https://x.test/gw",
        apiKey: "k",
        seats,
        fetchImpl: scriptedFetch([
          { "m-a": REJECT, "m-b": APPROVE, "m-c": REJECT },
          { "m-a": APPROVE, "m-b": APPROVE, "m-c": APPROVE },
        ]),
      },
      "subject",
    )
    expect(out.totalRounds).toBe(2)
    expect(out.consensus).toBe(true)
    // Round 1 must be recorded even though it failed.
    expect(out.rounds[0].approvals).toBe(1)
    expect(out.rounds[1].approvals).toBe(3)
  })

  it("reports NO CONSENSUS after hitting the round cap", async () => {
    const out = await runReview(
      {
        baseUrl: "https://x.test/gw",
        apiKey: "k",
        seats,
        maxRounds: 3,
        fetchImpl: scriptedFetch([{ "m-a": APPROVE, "m-b": REJECT, "m-c": REJECT }]),
      },
      "subject",
    )
    expect(out.consensus).toBe(false)
    expect(out.totalRounds).toBe(3)
    expect(out.finalRatio).toBeCloseTo(1 / 3, 5)
  })

  it("never reaches consensus when a report lacks a verdict, even if the rest approve", async () => {
    // 2/3 approvals with one malformed report. A naive implementation that
    // divides by valid responses would call this 100%.
    const out = await runReview(
      {
        baseUrl: "https://x.test/gw",
        apiKey: "k",
        seats,
        maxRounds: 2,
        fetchImpl: scriptedFetch([
          { "m-a": APPROVE, "m-b": APPROVE, "m-c": "I reviewed it but will not say." },
        ]),
      },
      "subject",
    )
    expect(out.consensus).toBe(false)
    expect(out.finalRatio).toBeCloseTo(2 / 3, 5)
  })

  it("uses the configured threshold rather than the default", async () => {
    // 2/3 = 67%. Reachable at a 60% threshold, not at 90%.
    const mk = () =>
      scriptedFetch([{ "m-a": APPROVE, "m-b": APPROVE, "m-c": REJECT }])
    const lax = await runReview(
      { baseUrl: "u", apiKey: "k", seats, thresholdPercent: 60, fetchImpl: mk() },
      "s",
    )
    expect(lax.consensus).toBe(true)

    const strict = await runReview(
      { baseUrl: "u", apiKey: "k", seats, thresholdPercent: 90, fetchImpl: mk() },
      "s",
    )
    expect(strict.consensus).toBe(false)
  })

  it("defaults to at most 5 rounds", async () => {
    const out = await runReview(
      {
        baseUrl: "u",
        apiKey: "k",
        seats,
        fetchImpl: scriptedFetch([{ "m-a": REJECT, "m-b": REJECT, "m-c": REJECT }]),
      },
      "s",
    )
    expect(out.totalRounds).toBe(5)
    expect(out.consensus).toBe(false)
  })
})

describe("formatOutcome", () => {
  it("names each seat, its resolved model, and the final ratio", async () => {
    const out = await runReview(
      {
        baseUrl: "u",
        apiKey: "k",
        seats,
        fetchImpl: scriptedFetch([{ "m-a": APPROVE, "m-b": APPROVE, "m-c": APPROVE }]),
      },
      "s",
    )
    const text = formatOutcome(out)
    expect(text).toContain("resolved-m-a")
    expect(text).toContain("architecture")
    expect(text).toMatch(/CONSENSUS REACHED/)
  })

  it("says NO CONSENSUS explicitly when the cap is reached", async () => {
    const out = await runReview(
      {
        baseUrl: "u",
        apiKey: "k",
        seats,
        maxRounds: 1,
        fetchImpl: scriptedFetch([{ "m-a": REJECT, "m-b": REJECT, "m-c": REJECT }]),
      },
      "s",
    )
    expect(formatOutcome(out)).toMatch(/NO CONSENSUS/)
  })
})
