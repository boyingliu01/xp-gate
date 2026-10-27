/**
 * Gate MW walkthrough evidence.
 *
 * @test REQ-DSH-012 delphi-review can produce Gate MW evidence
 * @intent Build the .code-walkthrough-result.json document that the pre-push
 *         validator accepts, from a review the plugin actually ran.
 * @covers AC-DSH-012-01
 *
 * Every field here mirrors a check in githooks/lib/validate-code-walkthrough.cjs.
 * Two of those checks are easy to misread and are pinned by test:
 *
 *  - result_type belongs to each EXPERT record. Putting it at the top level looks
 *    right, passes no check, and fails with a message that never mentions placement.
 *  - requested_model comes from the configured seat, never from the gateway's
 *    response. The gateway answers with its own naming (Qwen3_8-flash-next for a seat
 *    configured as local-qwen3.8-flash), so using the response tripped #574.
 */

/** The document Gate MW reads. Field names are the validator's, not ours. */
export interface WalkthroughEvidence {
  readonly commit: string
  readonly branch: string
  readonly timestamp: string
  readonly expires: string
  readonly consensus_ratio: number
  readonly verdict: "APPROVED"
  readonly experts: readonly EvidenceExpert[]
}

export interface EvidenceExpert {
  readonly role: string
  readonly requested_model: string
  readonly resolved_model: string
  /** Per-expert, not top-level. The validator reads it here. */
  readonly result_type: "delphi_expert_result"
  readonly channel: "external" | "local"
  readonly verdict: "APPROVED"
}

/** One seat as observed by the review: what we asked for, and what answered. */
export interface SeatOutcome {
  readonly role: string
  /** The model configured for this role. Becomes requested_model. */
  readonly model: string
  /** The model the gateway reported. Becomes resolved_model. */
  readonly resolved: string
}

export interface BuildEvidenceInput {
  readonly head: string
  readonly branch: string
  readonly seats: readonly SeatOutcome[]
  readonly verdict: string
  readonly now: Date
  /** Gateway URL, used to label provenance. */
  readonly baseUrl?: string
  /** Observed agreement. Defaults to unanimous, which is what a 3-seat APPROVED run is. */
  readonly consensusRatio?: number
}

/** The validator requires exactly three seats. */
const REQUIRED_SEATS = 3;

/** Evidence is valid for exactly this long; the validator checks the delta. */
const VALIDITY_MS = 3_600_000;

/** The validator rejects anything below this. */
const MIN_CONSENSUS = 0.9;

/**
 * Label a gateway as local or external.
 *
 * Only loopback counts as local: the validator uses this field as provenance, so a
 * private-network host is still external — nothing about it is verifiable from here.
 */
export function evidenceChannel(baseUrl: string): "local" | "external" {
  const lowered = baseUrl.toLowerCase()
  return lowered.includes("localhost") || lowered.includes("127.0.0.1") || lowered.includes("[::1]")
    ? "local"
    : "external"
}

/** Refuse to emit a document the validator would reject, and say which field. */
function assertSeatsUsable(seats: readonly SeatOutcome[]): void {
  if (seats.length !== REQUIRED_SEATS) {
    throw new Error(`evidence needs exactly ${REQUIRED_SEATS} seats; got ${seats.length}`)
  }
  const requested = new Set<string>()
  const resolved = new Set<string>()
  for (const seat of seats) {
    if (seat.resolved.trim() === "") {
      throw new Error(`seat "${seat.role}" has no resolved_model; a failed seat cannot produce evidence`)
    }
    // Both are checked case-insensitively by some validator paths, so assert on the
    // stricter reading: duplicated IDs mean one model answered twice.
    if (requested.has(seat.model.trim())) throw new Error(`duplicate requested_model "${seat.model}"`)
    if (resolved.has(seat.resolved.trim().toLowerCase())) {
      throw new Error(`duplicate resolved_model "${seat.resolved}"`)
    }
    requested.add(seat.model.trim())
    resolved.add(seat.resolved.trim().toLowerCase())
  }
}

/**
 * Build the evidence document.
 *
 * Refuses on anything the validator would reject rather than emitting a document
 * that fails at push time, where the cause is much harder to see.
 */
export function buildEvidence(input: BuildEvidenceInput): WalkthroughEvidence {
  if (input.verdict !== "APPROVED") {
    throw new Error(`evidence requires an APPROVED review; got ${input.verdict}`)
  }
  assertSeatsUsable(input.seats)

  const ratio = input.consensusRatio ?? 1
  if (ratio < MIN_CONSENSUS || ratio > 1) {
    throw new Error(`consensus_ratio must be ${MIN_CONSENSUS} through 1; got ${ratio}`)
  }

  const channel = evidenceChannel(input.baseUrl ?? "")
  const expires = new Date(input.now.getTime() + VALIDITY_MS)

  return {
    commit: input.head,
    branch: input.branch,
    timestamp: input.now.toISOString(),
    expires: expires.toISOString(),
    consensus_ratio: ratio,
    verdict: "APPROVED",
    experts: input.seats.map((seat) => ({
      role: seat.role,
      requested_model: seat.model,
      resolved_model: seat.resolved,
      result_type: "delphi_expert_result",
      channel,
      verdict: "APPROVED",
    })),
  }
}
