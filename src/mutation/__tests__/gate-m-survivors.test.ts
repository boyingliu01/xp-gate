/**
 * @test #544 - Gate M survivor detail for retro
 * @intent Verify Gate M reports per-file mutant outcome counts, not just a
 *         score. #544: the pre-push journal carried
 *         {skip_reason, duration_ms, mutation_score} and nothing else, so
 *         `xp-gate retro` could not answer "which module has the most surviving
 *         mutants". The data was never missing at the source: Stryker's JSON
 *         reporter emits files[].nrOfSurvivedMutants, and stryker-types.ts
 *         already declares it. The counts were dropped on the way through, then
 *         buildMutationScores hardcoded {mutants: 0, killed: 0, survived: 0}.
 *         Three zeros written next to a real score read as "measured: no
 *         survivors" -- the same class of false success this project keeps
 *         fixing, so unknown must stay absent, never zero.
 * @covers REQ-MUT-001 AC-001
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeSurvivors,
  buildMutationScores,
  type StrykerReportLike,
  type SurvivorSummary,
} from '../gate-m';

/** A report shaped like Stryker's JSON output. */
function report(files: Record<string, [number, number, number]>): StrykerReportLike {
  const entries = Object.entries(files);
  const totalMutants = entries.reduce((a, [, v]) => a + v[0], 0);
  const totalKilled = entries.reduce((a, [, v]) => a + v[1], 0);
  const totalSurvived = entries.reduce((a, [, v]) => a + v[2], 0);
  return {
    mutationScore: totalMutants > 0 ? parseFloat(((totalKilled / totalMutants) * 100).toFixed(1)) : 100,
    nrOfMutants: totalMutants,
    nrOfKilledMutants: totalKilled,
    nrOfSurvivedMutants: totalSurvived,
    files: Object.fromEntries(
      entries.map(([k, [m, kd, sv]]) => [k, {
        mutationScore: m > 0 ? parseFloat(((kd / m) * 100).toFixed(1)) : 100,
        nrOfMutants: m,
        nrOfKilledMutants: kd,
        nrOfSurvivedMutants: sv,
      }])
    ),
  };
}

/** Narrow to a non-null summary, failing the test with a clear message. */
function expectSummary(s: SurvivorSummary | null): SurvivorSummary {
  expect(s).not.toBeNull();
  if (s === null) throw new Error('expected a survivor summary, got null');
  return s;
}

describe('AC-544: Gate M survivor detail', () => {
  it('reports per-file survived counts from the Stryker report', () => {
    const summary = expectSummary(summarizeSurvivors(report({
      'src/mutation/gate-m.ts': [20, 8, 12],
      'src/principles/analyzer.ts': [10, 3, 7],
    })));

    expect(summary.survivedByFile).toEqual({
      'src/mutation/gate-m.ts': 12,
      'src/principles/analyzer.ts': 7,
    });
  });

  it('totals killed, survived and mutants', () => {
    const summary = expectSummary(summarizeSurvivors(report({
      'a.ts': [20, 8, 12],
      'b.ts': [10, 3, 7],
    })));

    expect(summary.mutants).toBe(30);
    expect(summary.killed).toBe(11);
    expect(summary.survived).toBe(19);
  });

  it('orders survivedByFile worst-first so retro can take the top N', () => {
    const summary = expectSummary(summarizeSurvivors(report({
      'small.ts': [10, 9, 1],
      'worst.ts': [10, 0, 10],
      'middle.ts': [10, 5, 5],
    })));

    expect(Object.keys(summary.survivedByFile)).toEqual(['worst.ts', 'middle.ts', 'small.ts']);
  });

  it('caps the per-file map so one huge repo cannot bloat the journal', () => {
    const many: Record<string, [number, number, number]> = {};
    // Every file must have at least one survivor, otherwise this asserts on a
    // smaller population than intended and the count below drifts.
    for (let i = 0; i < 50; i++) {
      const survived = (i % 9) + 1; // 1..9, never 0
      many[`f${i}.ts`] = [10, 10 - survived, survived];
    }

    const summary = expectSummary(summarizeSurvivors(report(many), { limit: 20 }));

    expect(Object.keys(summary.survivedByFile)).toHaveLength(20);
    // Truncation must be visible, not silent: a capped list that looks complete
    // is how "top 20" gets mistaken for "all files".
    expect(summary.truncated).toBe(true);
    expect(summary.filesWithSurvivors).toBe(50);
  });

  it('does not claim truncation when everything fits', () => {
    const summary = expectSummary(summarizeSurvivors(report({ 'a.ts': [10, 5, 5] }), { limit: 20 }));
    expect(summary.truncated).toBe(false);
  });

  it('omits files with zero survivors', () => {
    const summary = expectSummary(summarizeSurvivors(report({
      'clean.ts': [10, 10, 0],
      'dirty.ts': [10, 4, 6],
    })));

    expect(summary.survivedByFile).toEqual({ 'dirty.ts': 6 });
  });

  it('degrades to null instead of inventing zeros when no report is available', () => {
    // A missing/timed-out report must not be reported as "0 survivors" -- that
    // is the #544 failure repeated. null means unknown.
    expect(summarizeSurvivors(null)).toBeNull();
  });

  it('degrades to null when the report has no per-file section', () => {
    expect(summarizeSurvivors({
      mutationScore: 80,
      nrOfMutants: 10,
      nrOfKilledMutants: 8,
      nrOfSurvivedMutants: 2,
    })).toBeNull();
  });
});

describe('buildMutationScores carries the real counts (#544)', () => {
  it('reports measured mutant counts instead of hardcoded zeros', () => {
    // The original defect: the score was real and the three counts beside it
    // were literal zeros, which reads as "measured, no survivors". A consumer
    // that trusts `survived: 0` concludes the module is adequately tested.
    const scores = buildMutationScores({ 'a.ts': 78.4 }, {
      'a.ts': { mutants: 30, killed: 25, survived: 5 },
    });

    expect(scores['a.ts']).toEqual({ score: 78.4, mutants: 30, killed: 25, survived: 5 });
  });

  it('leaves counts absent when they were never measured', () => {
    // Absent must stay absent -- not fabricated as zero.
    const scores = buildMutationScores({ 'a.ts': 50 }, {});

    expect(scores['a.ts'].score).toBe(50);
    expect(scores['a.ts'].mutants).toBeUndefined();
    expect(scores['a.ts'].survived).toBeUndefined();
  });

  it('keeps a genuinely zero-survivor file at zero', () => {
    // The distinction this whole change is about: measured zero is a real,
    // meaningful value and must survive the trip.
    const scores = buildMutationScores({ 'clean.ts': 100 }, {
      'clean.ts': { mutants: 12, killed: 12, survived: 0 },
    });

    expect(scores['clean.ts'].survived).toBe(0);
    expect(scores['clean.ts'].mutants).toBe(12);
  });
});
