import { describe, it, expect } from "vitest"
import { formatOutcome } from "./delphi-run.js"
import type { ReviewOutcome } from "./delphi-run.js"

/**
 * @test REQ-670 delphi 报告必须回传专家意见正文
 * @intent `formatOutcome` 只回传 verdict 与 confidence，把专家写的
 *         `### Findings` 表格整块丢掉。调用方拿到的是一串 REQUEST_CHANGES
 *         加上 0 条具体问题——评审消耗了真实模型调用，产出的却是不可行动的信息。
 *
 *         这个 bug 有个特殊之处：**数据一直都在**。`ExpertVerdict.report` 完整
 *         保留了专家原文，只是呈现层从来没读过它。所以这不是"信息不足"，是
 *         "攒了信息然后扔掉"——比前者更难发现，因为所有中间层看起来都是对的。
 *
 *         修复必须小心一个副作用：报告是多轮匿名评审，专家在后续轮次会看到
 *         聚合票型。若把每轮全文都打印出来，输出会迅速膨胀到不可读（3 席 × 5 轮
 *         × 300 字）。所以正文只在**最后一轮**展开，前面各轮仍只给票型——读者
 *         需要的是"最终为什么不通过"，不是五份历史副本。
 * @covers AC-670-66, AC-670-67
 */

const FINDINGS_REPORT =
  "### Findings\n| ID | Severity | Description | Location | Fix |\n|---|---|---|---|---|\n" +
  "| F1 | critical | exit code discarded | run.ts:42 | propagate it |\n" +
  "\n### VERDICT\nREQUEST_CHANGES\n### CONFIDENCE\n9"

const APPROVED_REPORT = "### Findings\nNONE\n\n### VERDICT\nAPPROVED\n### CONFIDENCE\n8"

function verdict(id: string, role: string, report: string, verdictValue: string, confidence: number) {
  return {
    id,
    role,
    requestedModel: `m-${id}`,
    resolvedModel: `res-${id}`,
    verdict: verdictValue as "APPROVED" | "REQUEST_CHANGES",
    confidence,
    counted: true,
    report,
  }
}

/**
 * Build a ReviewOutcome from per-round verdicts.
 *
 * `consensusRatio` / `reachedConsensus` are computed the same way `runRound`
 * does rather than stubbed: `RoundResult` declares them as required, and a
 * fixture that hard-codes 0/false would be asserting against values the real
 * code can never produce for these inputs. `formatOutcome` does not read them
 * today (it takes consensus from the top-level fields), but a fixture that
 * disagrees with the producer is exactly how a later change gets "verified"
 * against something impossible.
 *
 * Delphi's seat/threshold constants are module-private in delphi.ts; they are
 * restated here on purpose so this fixture does not force the producer to widen
 * its public API just to be testable.
 */
const DELPHI_EXPERTS = 3
const DELPHI_THRESHOLD_PERCENT = 90

function outcomeOf(rounds: Array<{ round: number; verdicts: ReturnType<typeof verdict>[] }>): ReviewOutcome {
  const mapped = rounds.map((r) => {
    const counted = r.verdicts.filter((v) => v.counted)
    const approvals = counted.filter((v) => v.verdict === "APPROVED").length
    // Mirrors runRound: consensus is measured over VALID responses only.
    const consensusRatio = counted.length === 0 ? 0 : approvals / counted.length
    return {
      round: r.round,
      approvals,
      validCount: counted.length,
      verdicts: r.verdicts,
      consensusRatio,
      reachedConsensus: counted.length === DELPHI_EXPERTS && consensusRatio * 100 >= DELPHI_THRESHOLD_PERCENT,
    }
  })
  return {
    rounds: mapped,
    consensus: false,
    finalRatio: 0,
    totalRounds: mapped.length,
  }
}

describe("formatOutcome 回传专家意见 (#670)", () => {
  it("AC-670-66: 最终轮的专家意见正文必须出现在输出里", () => {
    const out = outcomeOf([
      {
        round: 1,
        verdicts: [
          verdict("A", "architecture", FINDINGS_REPORT, "REQUEST_CHANGES", 9),
          verdict("B", "technical", APPROVED_REPORT, "APPROVED", 8),
        ],
      },
    ])
    const text = formatOutcome(out)
    // The whole point: a reviewer must be able to read what was wrong.
    expect(text).toContain("exit code discarded")
    expect(text).toContain("propagate it")
    // The verdict/confidence are already on the tally line; the excerpt must not
    // repeat them, or every seat's block doubles in size.
    expect(text).not.toContain("### VERDICT")
  })

  it("AC-670-67: 中间轮次只给票型，不重复整段正文（否则输出不可读）", () => {
    const out = outcomeOf([
      {
        round: 1,
        verdicts: [verdict("A", "architecture", FINDINGS_REPORT, "REQUEST_CHANGES", 9)],
      },
      {
        round: 2,
        verdicts: [verdict("A", "architecture", APPROVED_REPORT, "APPROVED", 8)],
      },
    ])
    const text = formatOutcome(out)
    // The final round approved with NONE, so the earlier rejection's findings are
    // historical and must not be expanded -- otherwise the reader sees a problem
    // that was already resolved as if it were still open.
    const occurrences = text.split("exit code discarded").length - 1
    expect(occurrences).toBe(0)
    // But the earlier round's tally line is still there: history is not erased.
    expect(text).toContain("## Round 1")
    expect(text).toContain("REQUEST_CHANGES")
  })

  it("AC-670-66: 报告无 Findings 标题时仍保留正文，而不是整块丢弃", () => {
    // The original bug's shape was "unrecognized format -> print nothing". A
    // fallback that also prints nothing would reproduce it under a new input.
    const freeform = "The suffix resets $? so every gate reads as passing.\n\n### VERDICT\nREQUEST_CHANGES\n### CONFIDENCE\n9"
    const out = outcomeOf([
      { round: 1, verdicts: [verdict("A", "architecture", freeform, "REQUEST_CHANGES", 9)] },
    ])
    const text = formatOutcome(out)
    expect(text).toContain("resets $?")
  })
})
