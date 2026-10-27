/**
 * @test REQ-DSH-012 delphi-review can produce Gate MW evidence
 * @intent Verify the walkthrough evidence document satisfies every field the
 *         pre-push validator checks, including the two constraints that are easy to
 *         get wrong: result_type belongs to each expert record, and requested_model
 *         comes from the configured seat rather than from the gateway's response.
 * @covers AC-DSH-012-01 AC-DSH-012-02 AC-DSH-012-03
 *
 * The stakes: Gate MW compares this document against HEAD at push time. A wrong
 * result_type is rejected with "expert X must be a successful Delphi expert result"
 * -- a message that says nothing about where the field belongs. Both mistakes were
 * made once already while building this by hand.
 */

import { describe, expect, it } from "vitest"
import { buildEvidence, evidenceChannel } from "./evidence.js"

/** A full-length SHA-1, which is what git rev-parse reports. */
const FULL_SHA_LENGTH = 40;

const HEAD = "a".repeat(FULL_SHA_LENGTH)
const BRANCH = "sprint/2026-10-27-01"
const NOW = new Date("2026-10-27T10:00:00.000Z")

const seats = [
  { role: "architecture", model: "local-deepseek-v4-flash", resolved: "DeepSeek-V4-Flash" },
  { role: "technical", model: "local-qwen3.8-flash", resolved: "Qwen3_8-flash-next" },
  { role: "feasibility", model: "local-qwen3.8-27b", resolved: "Qwen3_8-27b-next" },
]

describe("buildEvidence", () => {
  it("carries result_type on each expert, not at the top level", () => {
    const evidence = buildEvidence({ head: HEAD, branch: BRANCH, seats, verdict: "APPROVED", now: NOW })
    // The validator reads expert.result_type. A top-level copy looks right and is not.
    expect(evidence).not.toHaveProperty("result_type")
    for (const expert of evidence.experts) {
      expect(expert.result_type).toBe("delphi_expert_result")
    }
  })

  it("takes requested_model from the configured seat, not the gateway response", () => {
    const evidence = buildEvidence({ head: HEAD, branch: BRANCH, seats, verdict: "APPROVED", now: NOW })
    const technical = evidence.experts.find((e) => e.role === "technical")
    // These are genuinely different strings: the gateway reports its own naming.
    expect(technical?.requested_model).toBe("local-qwen3.8-flash")
    expect(technical?.resolved_model).toBe("Qwen3_8-flash-next")
  })

  it("stamps expires exactly one hour after timestamp", () => {
    const evidence = buildEvidence({ head: HEAD, branch: BRANCH, seats, verdict: "APPROVED", now: NOW })
    expect(evidence.timestamp).toBe("2026-10-27T10:00:00.000Z")
    expect(evidence.expires).toBe("2026-10-27T11:00:00.000Z")
    expect(Date.parse(evidence.expires) - Date.parse(evidence.timestamp)).toBe(3_600_000)
  })

  it("refuses to write evidence for a review that did not approve", () => {
    // Writing APPROVED evidence from a non-approving review would defeat Gate MW
    // entirely, so this is a throw rather than a field the caller can override.
    expect(() =>
      buildEvidence({ head: HEAD, branch: BRANCH, seats, verdict: "REQUEST_CHANGES", now: NOW }),
    ).toThrow()
  })

  it("refuses evidence when a seat failed to resolve a model", () => {
    const broken = seats.map((s, i) => (i === 1 ? { ...s, resolved: "" } : s))
    expect(() => buildEvidence({ head: HEAD, branch: BRANCH, seats: broken, verdict: "APPROVED", now: NOW })).toThrow()
  })

  it("marks local gateways local and public ones external", () => {
    expect(evidenceChannel("http://localhost:8080/v1")).toBe("local")
    expect(evidenceChannel("http://127.0.0.1:8080/v1")).toBe("local")
    expect(evidenceChannel("https://lab.iwhalecloud.com/gpt-proxy")).toBe("external")
  })
})
