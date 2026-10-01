/**
 * Delphi review orchestration: iterate rounds until consensus or the cap.
 *
 * @test REQ-DSH-016
 * @intent 编排多轮交叉评审：首轮匿名独立评审，后续轮次反馈上一轮汇总，
 *         直到达到共识阈值（默认 90%）或触及轮次上限（默认 5），
 *         并把结果整理成可写成 .code-walkthrough-result.json 的证据。
 * @covers AC-DSH-016-03
 */

import type { DelphiOptions, ExpertSeat, RoundResult } from "./delphi.js"
import { runRound } from "./delphi.js"

/** Mirrors delphi.ts; declared here so orchestrators need not import internals. */
const DEFAULT_THRESHOLD_PERCENT = 90
const DEFAULT_MAX_ROUNDS = 5

export interface ReviewOutcome {
  readonly rounds: readonly RoundResult[]
  readonly consensus: boolean
  readonly finalRatio: number
  readonly totalRounds: number
}

/** Anonymous first round: each seat answers the same question with no peers. */
function roundOnePrompt(seat: ExpertSeat, subject: string): string {
  return (
    `You are the ${seat.role.toUpperCase()} expert. Review the material below INDEPENDENTLY. ` +
    `Do not assume other reviewers exist or agree with you.\n\n${subject}\n\n` +
    `Respond with <=300 words under the headings: "### Findings" (a markdown table of ` +
    `ID | Severity | Description | Location | Fix, or a single NONE row), then "### VERDICT" ` +
    `followed by exactly APPROVED or REQUEST_CHANGES, then "### CONFIDENCE" followed by an ` +
    `integer 1-10. Approve only if you would personally ship this.`
  )
}

/**
 * Later rounds: feed back the aggregate so seats can revise their position.
 * Individual reports stay anonymous -- only the tally and the addressed items
 * are shared, which is what keeps the method honest.
 */
function laterRoundPrompt(
  seat: ExpertSeat,
  subject: string,
  previous: RoundResult,
  addressed: string,
): string {
  const tally = previous.verdicts
    .map((v) => `- ${v.role}: ${v.verdict}`)
    .join("\n")

  return (
    `You are the ${seat.role.toUpperCase()} expert. This is ROUND ${previous.round + 1} of a ` +
    `Delphi consensus review. Individual peer reports are anonymous; only this aggregate is shared:\n\n` +
    `${tally}\nApprovals: ${previous.approvals}/${previous.validCount} ` +
    `(threshold ${DEFAULT_THRESHOLD_PERCENT}%).\n\n` +
    `${addressed ? `What changed since the last round:\n${addressed}\n\n` : ""}` +
    `Re-examine the material and revise or hold your position.\n\n${subject}\n\n` +
    `Respond with <=300 words: "### Round assessment" (2-3 sentences), "### Remaining blocking ` +
    `issues" (table, or a single NONE row), "### VERDICT" followed by exactly APPROVED or ` +
    `REQUEST_CHANGES, then "### CONFIDENCE" and an integer 1-10.`
  )
}

/**
 * Run a full review. Round 1 is anonymous; each later round sees the aggregate
 * plus whatever the caller says was addressed, then re-votes.
 */
export async function runReview(
  opts: DelphiOptions,
  subject: string,
  addressed = "",
): Promise<ReviewOutcome> {
  const threshold = opts.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS
  const rounds: RoundResult[] = []

  for (let n = 1; n <= maxRounds; n++) {
    const previous = rounds[rounds.length - 1]
    const result = previous
      ? await runRound(opts, n, "You are a rigorous senior code reviewer.", (seat) =>
          laterRoundPrompt(seat, subject, previous, addressed),
        )
      : await runRound(opts, 1, "You are a rigorous senior code reviewer.", (seat) =>
          roundOnePrompt(seat, subject),
        )

    rounds.push(result)

    // Threshold is a percentage of the whole panel, so a round with a malformed
    // report cannot reach consensus even if every valid seat approved.
    if (result.approvals / opts.seats.length * 100 >= threshold) {
      return {
        rounds,
        consensus: true,
        finalRatio: result.approvals / opts.seats.length,
        totalRounds: n,
      }
    }
  }

  const last = rounds[rounds.length - 1]
  return {
    rounds,
    consensus: false,
    finalRatio: last ? last.approvals / opts.seats.length : 0,
    totalRounds: rounds.length,
  }
}

/** Human-readable transcript for the tool result. */
export function formatOutcome(outcome: ReviewOutcome): string {
  const lines: string[] = []
  for (const r of outcome.rounds) {
    lines.push(`## Round ${r.round} — approvals ${r.approvals}/${r.validCount} valid`)
    for (const v of r.verdicts) {
      const model = v.resolvedModel ? `${v.requestedModel} -> ${v.resolvedModel}` : v.requestedModel
      const note = v.error ? ` (${v.error})` : ""
      lines.push(`- [${v.role}] ${v.id} (${model}): ${v.verdict} confidence=${v.confidence}${note}`)
    }
    lines.push("")
  }
  lines.push(
    outcome.consensus
      ? `CONSENSUS REACHED: ${(outcome.finalRatio * 100).toFixed(0)}% after ${outcome.totalRounds} round(s).`
      : `NO CONSENSUS: ${(outcome.finalRatio * 100).toFixed(0)}% after ${outcome.totalRounds} round(s) (cap reached).`,
  )
  return lines.join("\n")
}
