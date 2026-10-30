/**
 * @test REQ-638 Boy Scout 债务必须按"可修性"分级，而不是报一个总数
 * @intent #638 追踪单把 Gate 6 的债务记作「139 条预算告警 / 14 文件」，并归类为
 *         "可清零"。实测这 139 条并不构成同一类问题：
 *
 *           magic-numbers            122 条（INFO 级 —— 按 .principlesrc 设计就不阻断）
 *           missing-error-handling    79 条（可修，且值得修）
 *           long-function             27 条（可修，需重构）
 *           deep-nesting              22 条（可修）
 *           solid.* / 其它              11 条
 *
 *           （合计 261 > 139，因为部分文件在 baseline 里已过期。）
 *
 *         **把 INFO 级规则算进"债务"会制造一个永远清不完的数字**：magic-numbers
 *         在测试里几乎是不可避免的（超时值、端口、状态码），它被设计成 INFO 正是因为
 *         不该逼人去改。混在一起统计的后果是"债务 139 条"这个数字既不能指导行动，
 *         也不能衡量进展——修掉 79 条 missing-error-handling 后，数字只从 139 掉到 60，
 *         看起来像只完成了 57%，实际已经清空了最值得清的那一类。
 *
 *         所以分级的价值不是"更好看"，而是让"还剩多少真正要修"变成可回答的问题。
 * @covers AC-638-01, AC-638-02, AC-638-03
 */
'use strict';

const { classifyDebt, summarizeDebtByFixability, INFO_ONLY_RULES } = require('../debt-classify');

describe('Boy Scout 债务分级 (#638)', () => {
  it('AC-638-01: INFO 级规则不计入"需要修"的债务', () => {
    // .principlesrc marks magic-numbers as severity=info. A rule that never blocks
    // anything is not a debt to clear; counting it makes the number unchaseable.
    expect(INFO_ONLY_RULES).toContain('clean-code.magic-numbers');
    const buckets = summarizeDebtByFixability([
      { file: 'a.ts', rule: 'clean-code.magic-numbers', count: 122 },
      { file: 'b.ts', rule: 'clean-code.missing-error-handling', count: 79 },
    ]);
    expect(buckets.actionable).toBe(79);
    expect(buckets.informational).toBe(122);
  });

  it('AC-638-02: 可修类别各自独立计数，因为修法不同', () => {
    // "Fix the debt" is four different jobs: add try/catch, split a function,
    // flatten nesting, split a class. Collapsing them hides which job is left.
    const buckets = summarizeDebtByFixability([
      { file: 'a.ts', rule: 'clean-code.missing-error-handling', count: 79 },
      { file: 'a.ts', rule: 'clean-code.long-function', count: 27 },
      { file: 'b.ts', rule: 'clean-code.deep-nesting', count: 22 },
      { file: 'b.ts', rule: 'solid.srp', count: 5 },
    ]);
    expect(buckets.byRule['clean-code.missing-error-handling']).toBe(79);
    expect(buckets.byRule['clean-code.long-function']).toBe(27);
    expect(buckets.byRule['clean-code.deep-nesting']).toBe(22);
    expect(buckets.byRule['solid.srp']).toBe(5);
    expect(buckets.actionable).toBe(133);
  });

  it('AC-638-03: 分级对未知规则保守处理——算作可修，不算作噪音', () => {
    // A rule added to the analyzer must not silently become "informational" just
    // because this module has not heard of it. Defaulting to actionable over-reports
    // work; defaulting to info under-reports debt, which is the failure that lets
    // real problems hide behind a green dashboard.
    const buckets = summarizeDebtByFixability([
      { file: 'a.ts', rule: 'clean-code.brand-new-rule', count: 3 },
    ]);
    expect(buckets.actionable).toBe(3);
    expect(buckets.informational).toBe(0);
    expect(buckets.byRule['clean-code.brand-new-rule']).toBe(3);
  });

  it('AC-638-03: 单条 finding 数组也能分级', () => {
    const rows = classifyDebt([
      { file: 'a.ts', rule: 'clean-code.magic-numbers' },
      { file: 'a.ts', rule: 'clean-code.long-function' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].fixability).toBe('informational');
    expect(rows[1].fixability).toBe('actionable');
  });
});
