import { describe, it, expect } from "vitest"
import { DelphiConfigError, parseVerdict, runRound, validateSeats } from "./delphi.js"
import type { ExpertSeat } from "./delphi.js"

/**
 * @test REQ-DSH-016
 * @intent 验证多模型交叉评审的核心不变量：恰好 3 位专家、requested_model 两两不同、
 *         缺少模型或未展开的 ${ENV} 占位符必须在校验期而非网络期报错；
 *         并验证裁决解析与共识计算不会被畸形报告污染。
 * @covers AC-DSH-016-01
 */

const seats: ExpertSeat[] = [
  { id: "A", role: "architecture", model: "g-glm-5.3-flash", maxTokens: 32000 },
  { id: "B", role: "technical", model: "g-qwen3.8-flash" },
  { id: "C", role: "feasibility", model: "g-deepseek-flash" },
]

describe("validateSeats", () => {
  it("accepts exactly three seats with distinct models", () => {
    expect(() => validateSeats(seats)).not.toThrow()
  })

  it("rejects a panel that is not exactly three", () => {
    expect(() => validateSeats(seats.slice(0, 2))).toThrow(DelphiConfigError)
    expect(() => validateSeats([...seats, { id: "D", role: "x", model: "m4" }])).toThrow(
      /exactly 3/,
    )
  })

  it("rejects duplicate models, since Delphi rests on reviewers differing", () => {
    const dup = [seats[0], seats[1], { ...seats[2], model: "g-qwen3.8-flash" }]
    expect(() => validateSeats(dup)).toThrow(/distinct/)
  })

  it("treats models differing only by whitespace as duplicates", () => {
    const padded = [seats[0], seats[1], { ...seats[2], model: " g-qwen3.8-flash " }]
    expect(() => validateSeats(padded)).toThrow(/distinct/)
  })

  it("rejects an empty model (a local fallback cannot count)", () => {
    expect(() => validateSeats([seats[0], seats[1], { ...seats[2], model: "  " }])).toThrow(
      /fallback|no model/i,
    )
  })

  it("rejects an unexpanded env placeholder before any network call", () => {
    expect(() => validateSeats([seats[0], seats[1], { ...seats[2], model: "${MODEL_ID}" }])).toThrow(
      /unexpanded/,
    )
  })
})

describe("parseVerdict", () => {
  it("reads the verdict on the line after the heading", () => {
    // The real reports put the token on the next line; a same-line
    // `VERDICT: X` pattern misses every one of them.
    expect(parseVerdict("### VERDICT\nAPPROVED\n\n### CONFIDENCE\n8").verdict).toBe("APPROVED")
    expect(parseVerdict("### VERDICT\nREQUEST_CHANGES\n### CONFIDENCE\n7").verdict).toBe(
      "REQUEST_CHANGES",
    )
  })

  it("also accepts a same-line form", () => {
    expect(parseVerdict("VERDICT: APPROVED\nCONFIDENCE: 9").verdict).toBe("APPROVED")
  })

  it("maps PASS_WITH_CAVEATS and BLOCKED to non-approval", () => {
    // Neither reaches the 90% bar as an approval.
    expect(parseVerdict("### VERDICT\nPASS_WITH_CAVEATS\nCONFIDENCE 6").verdict).toBe(
      "REQUEST_CHANGES",
    )
    expect(parseVerdict("### VERDICT\nBLOCKED\nCONFIDENCE 2").verdict).toBe("REQUEST_CHANGES")
  })

  it("marks a report with no verdict as INVALID rather than guessing", () => {
    // Observed in practice: a reviewer analysed everything but omitted the
    // verdict. Inferring approval from prose would pass a gate on a guess.
    const proseOnly = "The fixes look correct. Non-blocking concerns only. No critical defects."
    expect(parseVerdict(proseOnly).verdict).toBe("INVALID_NO_VERDICT")
    expect(parseVerdict(proseOnly).confidence).toBe(0)
  })

  it("clamps confidence into 1-10 and defaults to 0 when absent", () => {
    expect(parseVerdict("VERDICT APPROVED CONFIDENCE 99").confidence).toBe(10)
    expect(parseVerdict("VERDICT APPROVED").confidence).toBe(0)
  })
})

describe("runRound", () => {
  function fakeFetch(bodies: Record<string, string>, status = 200) {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string
      if (!(model in bodies)) {
        return new Response("no such model", { status: 404 })
      }
      return new Response(
        JSON.stringify({
          model: `resolved-${model}`,
          choices: [{ finish_reason: "stop", message: { content: bodies[model] } }],
        }),
        { status, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
  }

  const opts = {
    baseUrl: "https://example.test/gw",
    apiKey: "k",
    seats,
    fetchImpl: fakeFetch({
      "g-glm-5.3-flash": "### VERDICT\nAPPROVED\n### CONFIDENCE\n8",
      "g-qwen3.8-flash": "### VERDICT\nAPPROVED\n### CONFIDENCE\n9",
      "g-deepseek-flash": "### VERDICT\nREQUEST_CHANGES\n### CONFIDENCE\n7",
    }),
  }

  it("runs every seat and records the resolved model per seat", async () => {
    const r = await runRound(opts, 1, "sys", () => "task")
    expect(r.verdicts).toHaveLength(3)
    expect(r.verdicts.map((v) => v.requestedModel)).toEqual([
      "g-glm-5.3-flash",
      "g-qwen3.8-flash",
      "g-deepseek-flash",
    ])
    expect(r.verdicts[0].resolvedModel).toBe("resolved-g-glm-5.3-flash")
  })

  it("computes the ratio over valid responses and does not call 2/3 consensus", async () => {
    const r = await runRound(opts, 1, "sys", () => "task")
    expect(r.approvals).toBe(2)
    expect(r.validCount).toBe(3)
    expect(r.consensusRatio).toBeCloseTo(2 / 3, 5)
    // 67% < 90%
    expect(r.reachedConsensus).toBe(false)
  })

  it("cannot reach consensus when a report is malformed, even if all valid seats approve", async () => {
    const r = await runRound(
      {
        ...opts,
        fetchImpl: fakeFetch({
          "g-glm-5.3-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          "g-qwen3.8-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          // No verdict section at all -- must not count as agreement.
          "g-deepseek-flash": "Everything looks fine to me.",
        }),
      },
      2,
      "sys",
      () => "task",
    )
    expect(r.verdicts[2].verdict).toBe("INVALID_NO_VERDICT")
    expect(r.verdicts[2].counted).toBe(false)
    expect(r.validCount).toBe(2)
    expect(r.reachedConsensus).toBe(false)
  })

  it("records a transport failure as ERROR without aborting the round", async () => {
    const r = await runRound(
      {
        ...opts,
        fetchImpl: fakeFetch({
          "g-glm-5.3-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          "g-qwen3.8-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          // g-deepseek-flash is absent from the map, so it 404s.
        }),
      },
      1,
      "sys",
      () => "task",
    )
    const errored = r.verdicts.filter((v) => v.verdict === "ERROR")
    expect(errored).toHaveLength(1)
    expect(errored[0].counted).toBe(false)
    expect(errored[0].error).toMatch(/404/)
    // The two healthy seats still produced counts; the failure is isolated.
    expect(r.validCount).toBe(2)
    // A dead seat means the panel is incomplete, so no consensus.
    expect(r.reachedConsensus).toBe(false)
  })

  it("treats empty content as an error rather than an empty review", async () => {
    // Reasoning models can spend their entire budget on hidden tokens and
    // return nothing; that must surface as a failure, not a blank approval.
    const r = await runRound(
      {
        ...opts,
        fetchImpl: fakeFetch({
          "g-glm-5.3-flash": "",
          "g-qwen3.8-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          "g-deepseek-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
        }),
      },
      1,
      "sys",
      () => "task",
    )
    const blank = r.verdicts.find((v) => v.requestedModel === "g-glm-5.3-flash")
    expect(blank?.verdict).toBe("ERROR")
    expect(blank?.error).toMatch(/empty content/)
  })

  it("reaches consensus when all three approve", async () => {
    const r = await runRound(
      {
        ...opts,
        fetchImpl: fakeFetch({
          "g-glm-5.3-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
          "g-qwen3.8-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 9",
          "g-deepseek-flash": "### VERDICT\nAPPROVED\nCONFIDENCE 8",
        }),
      },
      3,
      "sys",
      () => "task",
    )
    expect(r.approvals).toBe(3)
    expect(r.consensusRatio).toBe(1)
    expect(r.reachedConsensus).toBe(true)
  })
})
