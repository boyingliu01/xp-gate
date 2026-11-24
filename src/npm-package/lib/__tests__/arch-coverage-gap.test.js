/**
 * @test REQ-ARCH-COVERAGE-GAP
 * @intent 这是 #590 的核心：archlint 在一个 140 文件的 Swift 项目上只分析了 1 个文件，
 *         报了 `total_smells: 0`，于是给出 `10.0 / Excellent`。
 *
 *         那意味着 Gate 6 存在的每一类检查——循环依赖、上帝模块、死代码、霰弹式
 *         修改——**全部被静默跳过**，而报告说架构很好。
 *
 *         "没看" 和 "看了没发现" 必须能区分。所以：
 *         - 覆盖不足时**扣留**分数（`summary: null`），但**仍报告已发现的 smells**
 *           （它们是真实的，与覆盖率无关）；
 *         - 没有可比数据时**不**扣留——凭猜测扣留比缺陷本身更糟；
 *         - JSON 解析失败或缺少 `smells` 数组时**fail closed**，不能读成"零问题"。
 *
 * @covers AC-ARCH-COVERAGE-GAP-01
 * @covers AC-ARCH-COVERAGE-GAP-02
 * @covers AC-ARCH-COVERAGE-GAP-03
 */
import { describe, expect, it } from 'vitest';

const { __internals } = require('../arch.js');
const { analysisCoverageGap, verdictFromScanJson } = __internals;

describe('analysisCoverageGap', () => {
  it('withholds the grade when only a sliver of the project was analysed', () => {
    // The measured case: 1 of 140 files, graded 10.0.
    const gap = analysisCoverageGap({ files_analyzed: 1 }, { projectFileCount: 140, dominantLanguage: 'Swift' });
    expect(gap).not.toBeNull();
    // The numbers must be in the message: "1 of 140" is believed, "low coverage" is an
    // opinion.
    expect(gap).toContain('1 of 140');
    expect(gap).toContain('Swift');
    expect(gap).toContain('withheld');
  });

  it('accepts a grade backed by a real scan', () => {
    expect(analysisCoverageGap({ files_analyzed: 139 }, { projectFileCount: 140 })).toBeNull();
  });

  it('says nothing when there is no grade to judge', () => {
    expect(analysisCoverageGap(null, { projectFileCount: 10 })).toBeNull();
  });

  it('does NOT withhold on a guess when a count is missing', () => {
    // Withholding from every caller that has not supplied a count would be worse than
    // the defect this guards.
    expect(analysisCoverageGap({ files_analyzed: 1 }, {})).toBeNull();
    expect(analysisCoverageGap({ files_analyzed: 1 }, { projectFileCount: 0 })).toBeNull();
    expect(analysisCoverageGap({ files_analyzed: 1 }, undefined)).toBeNull();
  });

  it('falls back to a generic subject when the language is unknown', () => {
    const gap = analysisCoverageGap({ files_analyzed: 1 }, { projectFileCount: 100 });
    expect(gap).toContain('the project');
  });
});

describe('verdictFromScanJson', () => {
  const okPayload = JSON.stringify({
    smells: [],
    summary: { files_analyzed: 100, total_smells: 0, score: 10 },
  });

  it('returns a clean verdict for a healthy scan', () => {
    const v = verdictFromScanJson(okPayload, { projectFileCount: 100 });
    expect(v.parseError).toBeNull();
    expect(v.total).toBe(0);
    expect(v.blocking).toBe(0);
    expect(v.coverageGap).toBeNull();
    expect(v.summary).not.toBeNull();
  });

  it('counts only high/critical smells as blocking', () => {
    const payload = JSON.stringify({
      smells: [
        { severity: 'high', rule: 'cycle' },
        { severity: 'CRITICAL', rule: 'god' },
        { severity: 'low', rule: 'style' },
        { severity: 'medium', rule: 'noise' },
      ],
      summary: { files_analyzed: 10 },
    });
    const v = verdictFromScanJson(payload, { projectFileCount: 10 });
    expect(v.total).toBe(4);
    expect(v.blocking).toBe(2);
    // Severity matching is case-insensitive; a payload saying CRITICAL is still critical.
    expect(v.blockingDetails).toHaveLength(2);
  });

  it('withholds the grade but still reports the findings when coverage is thin', () => {
    // The findings are real regardless of coverage; only the SCORE is a claim about
    // the whole project.
    const payload = JSON.stringify({
      smells: [{ severity: 'high', rule: 'cycle' }],
      summary: { files_analyzed: 1, score: 10 },
    });
    const v = verdictFromScanJson(payload, { projectFileCount: 140 });
    expect(v.total).toBe(1);
    expect(v.blocking).toBe(1);
    expect(v.summary).toBeNull();
    expect(v.coverageGap).not.toBeNull();
  });

  it('fails closed on unparseable JSON instead of reporting zero findings', () => {
    const v = verdictFromScanJson('not json at all', {});
    expect(v.parseError).toContain('could not be parsed');
    expect(v.total).toBe(0);
  });

  it('fails closed when the payload has no smells array (schema drift)', () => {
    // archlint always emits `smells` on a successful scan. Reading its absence as
    // "zero findings" would silently PASS a renamed or restructured report.
    const v = verdictFromScanJson(JSON.stringify({ summary: { files_analyzed: 10 } }), {});
    expect(v.parseError).toContain('no smells array');
  });

  it('caps the blocking preview so a wall of findings stays readable', () => {
    const smells = Array.from({ length: 25 }, (_, i) => ({ severity: 'high', rule: `r${i}` }));
    const v = verdictFromScanJson(
      JSON.stringify({ smells, summary: { files_analyzed: 10 } }),
      { projectFileCount: 10 },
    );
    expect(v.blocking).toBe(25);
    expect(v.blockingDetails.length).toBeLessThan(25);
  });
});
