/**
 * Delphi review orchestration: iterate rounds until consensus or the cap.
 *
 * @test REQ-DSH-016
 * @intent 编排多轮交叉评审：首轮匿名独立评审，后续轮次反馈上一轮汇总，
 *         直到达到共识阈值（默认 90%）或触及轮次上限（默认 5），
 *         并把结果整理成可写成 .code-walkthrough-result.json 的证据。
 * @covers AC-DSH-016-03
 */

import { TOOL_ABORTED } from "@deepseek-ai/dsh-tools"
import { HarnessError } from "@deepseek-ai/dsh-llm"

import type { DelphiOptions, ExpertSeat, ExpertVerdict, RoundResult } from "./delphi.js"
import { runRound } from "./delphi.js"

/**
 * Raise TOOL_ABORTED once the caller's signal has fired.
 *
 * Deliverance matches the gate tools exactly, so a cancelled review reads as a
 * cancellation in the UI rather than as a provider outage.
 */
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new HarnessError("tool call aborted", TOOL_ABORTED)
  error.name = "AbortError"
  throw error
}

/** Mirrors delphi.ts; declared here so orchestrators need not import internals. */
const DEFAULT_THRESHOLD_PERCENT = 90;
const DEFAULT_MAX_ROUNDS = 5;

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
  signal?: AbortSignal,
): Promise<ReviewOutcome> {
  const threshold = opts.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS
  const rounds: RoundResult[] = []
  // A round swallows per-seat failures into ERROR verdicts, so cancellation has to
  // be checked around them: otherwise an abort would surface as three ERROR seats and
  // the review would grind on through every remaining round.
  const effective: DelphiOptions = { ...opts, signal }
  assertNotAborted(signal)

  for (let n = 1; n <= maxRounds; n++) {
    const previous = rounds[rounds.length - 1]
    const result = previous
      ? await runRound(effective, n, "You are a rigorous senior code reviewer.", (seat) =>
          laterRoundPrompt(seat, subject, previous, addressed),
        )
      : await runRound(effective, 1, "You are a rigorous senior code reviewer.", (seat) =>
          roundOnePrompt(seat, subject),
        )

    assertNotAborted(signal)
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
/**
 * Reduce a seat's raw report to the part worth reading (#670).
 *
 * The seat was asked for `### Findings` / `### VERDICT` / `### CONFIDENCE`; the
 * verdict and confidence are already on the tally line above, so repeating them
 * here only makes the block longer. What the caller cannot get anywhere else is
 * the Findings table, which is why the report is trimmed down to it.
 */
function findingsExcerpt(report: string): string {
  const text = report.trim()
  if (text === "") return ""
  // Split on the section headings the prompt asks for; no regex escaping needed,
  // which keeps this readable and avoids a silently-mangled character class.
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{1,3}\s*Findings\s*$/i.test(line))
  if (start === -1) {
    // No Findings heading: keep everything before VERDICT rather than returning
    // nothing on an unexpected format.
    const stop = lines.findIndex((line) => /^#{1,3}\s*VERDICT/i.test(line))
    return (stop === -1 ? lines : lines.slice(0, stop)).join("\n").trim()
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s*[A-Z]/i.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join("\n").trim()
}

/**
 * One seat's tally line, plus its findings when this is the final round (#670).
 *
 * Only the final round expands: printing every round's full report would bury the
 * conclusion under five historical copies, and what the caller needs is "what is
 * still wrong", not a transcript.
 */
function verdictLines(v: ExpertVerdict, expand: boolean): string[] {
  const model = v.resolvedModel ? `${v.requestedModel} -> ${v.resolvedModel}` : v.requestedModel
  const note = v.error ? ` (${v.error})` : ""
  const lines = [`- [${v.role}] ${v.id} (${model}): ${v.verdict} confidence=${v.confidence}${note}`]
  if (!expand) return lines
  const excerpt = findingsExcerpt(v.report)
  if (excerpt === "") return lines
  for (const line of excerpt.split(/\r?\n/)) lines.push(`    ${line}`)
  return lines
}

export function formatOutcome(outcome: ReviewOutcome): string {
  const lines: string[] = []
  const lastRound = outcome.rounds.length
  for (const r of outcome.rounds) {
    lines.push(`## Round ${r.round} — approvals ${r.approvals}/${r.validCount} valid`)
    const expand = r.round === lastRound
    for (const v of r.verdicts) lines.push(...verdictLines(v, expand))
    lines.push("")
  }
  lines.push(
    outcome.consensus
      ? `CONSENSUS REACHED: ${(outcome.finalRatio * 100).toFixed(0)}% after ${outcome.totalRounds} round(s).`
      : `NO CONSENSUS: ${(outcome.finalRatio * 100).toFixed(0)}% after ${outcome.totalRounds} round(s) (cap reached).`,
  )
  return lines.join("\n")
}
