/**
 * @test REQ-651 rework
 * @intent #651 asks for a command that turns the gate journal into the three
 *        numbers rework management actually needs:
 *
 *          1. first-pass rate     -- how often a round clears the gates on try 1
 *          2. rework round stats  -- median / mean / worst rounds per landing
 *          3. top-N failing rules -- which rule_id blocks most often
 *
 *        Without (3) the only thing you can do is "try harder". With it, the
 *        answer to "why is development slow" becomes a ranked list.
 *
 *        Two data hazards decide the design:
 *
 *        - Before #651 the journal contained NO failures, so every derived rate
 *          was 100% by construction. A command that reports "first-pass rate: 100%"
 *          from an empty failure set is worse than no command: it manufactures
 *          confidence. So an input with zero FAIL records must report that the
 *          figure is NOT MEASURABLE, not that it is perfect.
 *
 *        - ~401 historical records carry epoch-sized `duration_ms` (flagged
 *          `duration_anomaly`). Any duration aggregate must exclude them rather
 *          than average them in -- one of them once produced "average 430 million
 *          seconds".
 *
 *        These tests exercise the pure aggregation function, so the numbers are
 *        pinned independently of file layout.
 * @covers AC-670-59, AC-670-60, AC-670-61, AC-670-62
 */
'use strict';

const { computeReworkStats } = require('../rework');

/** One journal record, defaulting to a pass. */
function rec(overrides) {
  return {
    timestamp: '2026-10-30T10:00:00.000Z',
    gate_id: '1',
    gate_name: 'Code Quality',
    passed: true,
    issues_found: 0,
    duration_ms: 1000,
    trigger: 'commit',
    ...overrides,
  };
}

describe('computeReworkStats (#651)', () => {
  it('AC-670-59: reports an unmeasurable first-pass rate when the journal has no failures', () => {
    // This is exactly the pre-#651 journal: thousands of passes, zero fails.
    const entries = Array.from({ length: 50 }, () => rec());
    const stats = computeReworkStats(entries);
    // A rate derived from an empty failure set is not 100% -- it is unknown.
    expect(stats.firstPassRate).toBeNull();
    expect(stats.measurable).toBe(false);
    expect(stats.reason).toMatch(/no failure/i);
  });

  it('AC-670-60: counts failing rules and ranks them, so the worst rule is actionable', () => {
    const entries = [
      rec({ passed: false, failure_reason: 'long-function' }),
      rec({ passed: false, failure_reason: 'long-function' }),
      rec({ passed: false, failure_reason: 'long-function' }),
      rec({ passed: false, failure_reason: 'tests_failed' }),
      rec(),
      rec(),
    ];
    const stats = computeReworkStats(entries);
    expect(stats.measurable).toBe(true);
    expect(stats.topFailures[0]).toEqual({ reason: 'long-function', count: 3 });
    expect(stats.topFailures[1]).toEqual({ reason: 'tests_failed', count: 1 });
    // 4 failures out of 6 attempts -> 33% first-pass.
    expect(stats.firstPassRate).toBeCloseTo(33.3, 1);
  });

  it('AC-670-61: excludes anomaly-flagged durations instead of averaging them in', () => {
    // A real epoch-sized value from the corpus; averaging it in produced
    // "average 430 million seconds" on gate-1.
    const entries = [
      rec({ duration_ms: 1000 }),
      rec({ duration_ms: 3000 }),
      rec({ duration_ms: 1784536915891, duration_anomaly: true }),
    ];
    const stats = computeReworkStats(entries);
    expect(stats.duration).not.toBeNull();
    // Median over the two sane values (1000, 3000) is 2000, not ~5.9e11.
    expect(stats.duration.medianMs).toBe(2000);
    expect(stats.duration.samples).toBe(2);
    expect(stats.duration.excludedAnomalies).toBe(1);
  });

  it('AC-670-62: a failure with no reason is bucketed, never silently dropped', () => {
    const entries = [
      rec({ passed: false }),                              // no failure_reason
      rec({ passed: false, failure_reason: '' }),          // empty
      rec({ passed: false, failure_reason: 'short-circuit' }),
    ];
    const stats = computeReworkStats(entries);
    // Dropping unlabelled failures would understate the failure count and push
    // the first-pass rate UP -- the optimistic direction is the dangerous one.
    expect(stats.failures).toBe(3);
    const unattributed = stats.topFailures.find((f) => /unattributed|unknown/i.test(f.reason));
    expect(unattributed, 'unlabelled failures must appear in the ranking').toBeDefined();
    expect(unattributed.count).toBe(2);
  });
});

describe('rework duration sampling (#651)', () => {
  it('AC-670-61: an UNFLAGGED epoch-sized duration is still excluded', () => {
    // Measured on the real journal: 391 records carry duration_anomaly, but 6
    // more epoch-sized values do not. Trusting the flag alone left the mean at
    // 1.3e9 ms -- the "average 430 million seconds" artifact returning through
    // the back door. Plausibility must be checked independently of the flag.
    const entries = [
      rec({ duration_ms: 2000 }),
      rec({ duration_ms: 4000 }),
      rec({ duration_ms: 1785001784992 }), // no duration_anomaly flag
    ];
    const stats = computeReworkStats(entries);
    expect(stats.duration).not.toBeNull();
    expect(stats.duration.medianMs).toBe(3000);
    expect(stats.duration.samples).toBe(2);
    // Excluded count covers BOTH flagged and implausible, or the sample size
    // looks closer to the record count than it really is.
    expect(stats.duration.excludedAnomalies).toBe(1);
  });
});
