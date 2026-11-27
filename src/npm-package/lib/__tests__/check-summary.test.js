/**
 * @test REQ-CHECK-SUMMARY
 * @intent 这两处输出都在防止同一类错误：**"没检查"不能和"通过"长得一样**。
 *
 *         - `formatGateTally` 只在计数非零时才列出该类别，但 `total` 永远在。
 *           一个 10/10 的总结如果其实是 5 个 pass + 5 个 skip，就是假的
 *           全绿（#568）。
 *         - `printBriefSummary` 把 `'NOT_RUN'` 映射成 SKIP，并且**不计入失败**，
 *           但它必须显式出现在屏幕上。把 GATE_NOT_RUN 那串字符串直接交给
 *           `process.exit()` 会让 Node 崩溃（#657）。
 *
 * @covers AC-CHECK-SUMMARY-01
 * @covers AC-CHECK-SUMMARY-02
 * @covers AC-CHECK-SUMMARY-03
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { formatGateTally, printBriefSummary, normalizeGateExit } = require('../check.js');

describe('formatGateTally', () => {
  it('omits zero categories but always states the total', () => {
    // "3 passed / 3 total" is the clean case; a "0 failed" would be noise.
    expect(formatGateTally({ passed: 3, failed: 0, warned: 0, skipped: 0, total: 3 }))
      .toBe('3 passed / 3 total');
  });

  it('names skips, so a partial run cannot read as a full one', () => {
    // #568: five of fifteen gates never executed and the summary still said
    // "passed". The skip count is what makes that visible.
    const tally = formatGateTally({ passed: 5, failed: 0, warned: 0, skipped: 5, total: 10 });
    expect(tally).toContain('5 skipped');
    expect(tally).toContain('10 total');
  });

  it('lists every non-zero category', () => {
    const tally = formatGateTally({ passed: 1, failed: 2, warned: 3, skipped: 4, total: 10 });
    expect(tally).toBe('1 passed / 2 failed / 3 warned / 4 skipped / 10 total');
  });
});

describe('normalizeGateExit', () => {
  it('passes a numeric verdict through', () => {
    expect(normalizeGateExit(0)).toBe(0);
    expect(normalizeGateExit(1)).toBe(1);
  });

  it('maps the NOT_RUN sentinel to 0 instead of letting process.exit crash', () => {
    // #657: GATE_NOT_RUN is a string. process.exit('NOT_RUN') throws, and a gate
    // that honestly reported "nothing to analyse" is not a failure.
    expect(normalizeGateExit('NOT_RUN')).toBe(0);
  });
});

describe('printBriefSummary', () => {
  let out;

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function text() {
    return out.join('\n');
  }

  it('says no source gate applies when only docs changed', () => {
    // Silence here would read as "it ran and found nothing", which is a different
    // claim from "there was nothing to run it on".
    const failures = printBriefSummary(['README.md'], [], [], 12);
    expect(failures).toBe(0);
    expect(text()).toContain('No source files changed');
  });

  it('marks a NOT_RUN result as SKIP and does not count it as blocking', () => {
    const failures = printBriefSummary(
      ['a.ts'], ['a.ts'],
      [{ id: '3', code: 0 }, { id: '4', code: 'NOT_RUN' }],
      5,
    );
    expect(failures).toBe(0);
    expect(text()).toContain('SKIP');
    expect(text()).toContain('✅ clear');
  });

  it('counts a non-zero code as blocking and reports the number', () => {
    const failures = printBriefSummary(
      ['a.ts'], ['a.ts'],
      [{ id: '3', code: 1 }, { id: '4', code: 2 }],
      7,
    );
    expect(failures).toBe(2);
    expect(text()).toContain('2 blocking');
    expect(text()).toContain('BLOCK');
  });

  it('names the commit-time gates it deliberately did not run', () => {
    // The reader must know this command did not cover them; otherwise "clear" is
    // read as "the whole gate chain is clear".
    printBriefSummary(['a.ts'], ['a.ts'], [{ id: '3', code: 0 }], 1);
    expect(text()).toContain('commit-time (not run here)');
  });

  it('includes the elapsed time so a suspiciously fast run is visible', () => {
    printBriefSummary(['a.ts'], ['a.ts'], [{ id: '3', code: 0 }], 42);
    expect(text()).toContain('42 ms');
  });
});
