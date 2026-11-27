/**
 * @test REQ-BASELINE-RATCHET
 * @intent 基线是**棘轮**：它记录已知问题，好让新问题显出来。这个属性只在
 *         "本轮没评估到的文件"被正确保留时才成立。
 *
 *         实测过的复发形态：某个 linter 跑不起来时，它的文件被写成"无条目"，
 *         于是一棵没变的树报出 `BLOCKED - 50 NEW shellcheck issue(s)
 *         (baseline: 0, current: 50)`——而这不是回归，是基线被清空了一半。
 *
 *         这段逻辑原本内联在 `createBaseline`（CCN 38）里，只有完整跑一次
 *         基线创建才能触及。
 *
 * @covers AC-BASELINE-RATCHET-01
 * @covers AC-BASELINE-RATCHET-02
 */
'use strict';

const { carryUnevaluated } = require('../baseline.js');

function captureLogs(run) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try { return { result: run(), out: out.join('\n') }; } finally { console.log = orig; }
}

describe('carryUnevaluated', () => {
  it('keeps the previous entry for a file no linter evaluated', () => {
    const previous = { 'a.js': { shellcheck: { warnings: 3, errors: 0 }, totalWarnings: 3 } };
    const baseline = {};
    const { result } = captureLogs(() => carryUnevaluated(baseline, previous, new Set(['a.js'])));
    // The whole point: not evaluated is not clean.
    expect(baseline['a.js']).toEqual(previous['a.js']);
    expect(result).toBe(1);
  });

  it('lets an evaluated file shrink -- that is the ratchet working', () => {
    const previous = { 'a.js': { totalWarnings: 9 } };
    const baseline = { 'a.js': { totalWarnings: 2 } };
    const { result } = captureLogs(() => carryUnevaluated(baseline, previous, new Set(['a.js'])));
    // A file that WAS evaluated keeps its fresh value, even when lower.
    expect(baseline['a.js']).toEqual({ totalWarnings: 2 });
    expect(result).toBe(0);
  });

  it('does nothing for a file that was never in the baseline', () => {
    const baseline = {};
    const { result } = captureLogs(() => carryUnevaluated(baseline, {}, new Set(['new.js'])));
    expect(baseline).toEqual({});
    expect(result).toBe(0);
  });

  it('does not resurrect an entry the run deliberately dropped', () => {
    // `baseline[file]` set means "evaluated this run", even if the entry is empty.
    const previous = { 'a.js': { totalWarnings: 5 } };
    const baseline = { 'a.js': {} };
    captureLogs(() => carryUnevaluated(baseline, previous, new Set(['a.js'])));
    expect(baseline['a.js']).toEqual({});
  });

  it('says how many entries it kept, so the number is not silent', () => {
    const previous = { 'a.js': { totalWarnings: 1 }, 'b.js': { totalWarnings: 2 } };
    const { out } = captureLogs(() => carryUnevaluated({}, previous, new Set(['a.js', 'b.js'])));
    expect(out).toContain('Kept 2 baseline entry/entries');
    expect(out).toContain('not evaluated is not clean');
  });
});
