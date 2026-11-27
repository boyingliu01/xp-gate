import { describe, it, expect } from "vitest"

import {
  extractKeywords,
  keywordOverlap,
  matchFinding,
  normalizeLocation,
} from "./delphi-finding.js"
import type { CandidateFinding, Finding } from "./delphi-finding.js"

/**
 * @test REQ-DSH-016 finding 条目的身份必须由确定性匹配器维护
 * @intent 评审的轮次浪费在"问题已修但席位不改票"上，而冻结一个条目的前提是
 *         能稳定认出"这是同一条"。用标题哈希做身份时，中文措辞、标点、代码
 *         片段引用的任何微调都会改变哈希，于是 `resolved` 的冻结静默失效——
 *         没有报错，只是轮次悄悄变多，比直接失败更难发现。
 *
 *         因此身份不是哈希，是匹配器：主键是归一化后的文件路径（剔除会因
 *         无关改动漂移的行号），辅键是关键词集合。这里的每一条测试都在问
 *         同一个问题：**同一件事被重新描述一次，系统还认得出来吗？**
 * @covers AC-DSH-016-03
 */

function candidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    seat: "technical",
    severity: "critical",
    title: "prepare 阶段 catch 硬编码 restorePyproject(path, false)",
    location: "src/mutation/runners/mutmut-runner.ts:118",
    fix: "写入失败时不得删除用户备份",
    ...overrides,
  }
}

/** A settled finding, the way the ledger would hold it after a round. */
function settled(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "TC-01",
    seat: "technical",
    severity: "critical",
    title: "prepare 阶段 catch 硬编码 restorePyproject(path, false)",
    location: "src/mutation/runners/mutmut-runner.ts",
    keywords: extractKeywords("prepare 阶段 catch 硬编码 restorePyproject(path, false)"),
    fix: "写入失败时不得删除用户备份",
    status: "open",
    statusChangedAtRound: 1,
    ...overrides,
  }
}

describe("finding 身份：同一件事必须认得出来", () => {
  it("改标点、加行号、换中文措辞后仍是同一条", () => {
    const original = matchFinding(candidate(), [])
    const restated = matchFinding(
      candidate({
        title: "prepare 阶段的 catch 里，restorePyproject(path, false) 是硬编码的。",
        location: "src/mutation/runners/mutmut-runner.ts:204",
      }),
      [original.finding],
    )
    expect(restated.reused).toBe(true)
    expect(restated.finding.id).toBe(original.finding.id)
  })

  it("换了措辞但保留了标识符，也认得出来（rephrase）", () => {
    // Same path, deliberately disjoint wording, but the identifiers survive --
    // this is what a seat restating a finding in its own words looks like.
    const original = matchFinding(
      candidate({ title: "restorePyproject 在备份成功后仍会删除 pyproject 文件" }),
      [],
    )
    const rephrased = matchFinding(
      candidate({ title: "写 pyproject 失败时，restorePyproject 的调用会销毁原始文件" }),
      [original.finding],
    )
    expect(rephrased.reused).toBe(true)
    expect(rephrased.finding.id).toBe(original.finding.id)
  })

  it("同一路径上的不同问题必须是两条，不能合并", () => {
    const first = matchFinding(candidate(), [])
    const second = matchFinding(
      candidate({
        title: "scanLineForQuote 未处理转义引号导致状态翻转",
        location: "src/mutation/runners/mutmut-runner.ts:300",
      }),
      [first.finding],
    )
    expect(second.reused).toBe(false)
    expect(second.finding.id).not.toBe(first.finding.id)
  })

  it("不同路径上的相同措辞不合并", () => {
    const first = matchFinding(candidate(), [])
    const elsewhere = matchFinding(
      candidate({ location: "src/mutation/runners/other-runner.ts:10" }),
      [first.finding],
    )
    expect(elsewhere.reused).toBe(false)
  })

  it("关键词不足两个时不得仅凭重合判定为同一条（防误合并）", () => {
    // §10.1(a): one keyword gives Jaccard 0 or 1 and nothing between, so
    // merging on it is a coin flip presented as a similarity score.
    const single = ["pyproject"]
    expect(keywordOverlap(single, single)).toBe(0)
    const original = matchFinding(candidate({ title: "pyproject 文件被删除" }), [])
    const other = matchFinding(candidate({ title: "pyproject 会被覆盖", location: "src/x.ts:1" }), [
      original.finding,
    ])
    expect(other.reused).toBe(false)
  })

  it("已 disproved 的条目换个 location 重报，不得静默拿到新 ID（防绕过冻结）", () => {
    // §10.1(b): re-filing the same defect under a different path would mint a
    // fresh id and walk straight past the freeze. The matcher cannot merge
    // across paths -- that would merge genuinely different files -- so instead
    // it SURFACES the settled entry and leaves the decision to the caller.
    const disproved = settled({ status: "disproved" })
    const refiled = matchFinding(
      candidate({
        title: "prepare 阶段 catch 硬编码 restorePyproject(path, false)",
        location: "src/mutation/other-place.ts:9",
      }),
      [disproved],
    )
    expect(refiled.reused).toBe(false)
    expect(refiled.finding.id).not.toBe(disproved.id)
    // The guard: a new id is only legitimate if the caller SEES the settled one.
    expect(refiled.matchingDisproved?.id).toBe(disproved.id)
  })

  it("换路径且措辞完全不同的条目不被当成已证伪条目", () => {
    const disproved = settled({ status: "disproved" })
    const unrelated = matchFinding(
      candidate({ title: "scanLineForQuote 未处理转义引号", location: "src/x.ts:1" }),
      [disproved],
    )
    expect(unrelated.matchingDisproved).toBeUndefined()
  })
})

describe("状态与严重度", () => {
  it("复用条目继承原状态，不会因重报而变回 open", () => {
    const resolved = settled({ status: "resolved", statusChangedAtRound: 2 })
    const again = matchFinding(candidate(), [resolved])
    expect(again.reused).toBe(true)
    expect(again.finding.status).toBe("resolved")
  })

  it("严重度只升不降：升到 critical 被采纳，降到 minor 被拒绝", () => {
    const major = settled({ severity: "major" })
    expect(matchFinding(candidate({ severity: "critical" }), [major]).finding.severity).toBe("critical")

    const critical = settled({ severity: "critical" })
    expect(matchFinding(candidate({ severity: "minor" }), [critical]).finding.severity).toBe("critical")
  })

  it("两个席位报同一条目时 seat 记为 multi，而不是归属在其中一个名下", () => {
    const technical = settled({ seat: "technical" })
    const fromArch = matchFinding(candidate({ seat: "architecture" }), [technical])
    expect(fromArch.reused).toBe(true)
    expect(fromArch.finding.seat).toBe("multi")
  })

  it("新条目 ID 按席位前缀分配，且跳过已占用的序号", () => {
    const first = matchFinding(candidate(), [])
    expect(first.finding.id).toBe("TC-01")
    const second = matchFinding(candidate({ title: "另一个 scanLineForQuote 的问题" }), [first.finding])
    expect(second.finding.id).toBe("TC-02")
  })
})

describe("归一化与关键词提取", () => {
  it("location 去掉行号、前导 ./ 与重复斜杠", () => {
    expect(normalizeLocation("./src/a.ts:12")).toBe("src/a.ts")
    expect(normalizeLocation("src//a.ts")).toBe("src/a.ts")
    expect(normalizeLocation("src/a.ts:12:5")).toBe("src/a.ts")
  })

  it("关键词是 ASCII 标识符与反引号片段，去停用词、小写、去重", () => {
    const keywords = extractKeywords("`restorePyproject(path)` 在 the catch 里被 Hardcoded")
    expect(keywords).toContain("restorepyproject")
    expect(keywords).toContain("restorePyproject(path)".toLowerCase())
    expect(keywords).toContain("hardcoded")
    // `catch` is four characters and not a stopword, so it survives; `the` does not.
    expect(keywords).not.toContain("the")
    expect(new Set(keywords).size).toBe(keywords.length)
  })
})
