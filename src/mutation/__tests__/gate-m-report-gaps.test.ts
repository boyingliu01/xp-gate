/**
 * @test REQ-GATEM-REPORT-GAPS
 * @intent A file the run was asked about must never end up with an ABSENT score.
 *
 *         `applyPerFileScores` only visited the keys the reporter returned. A reporter
 *         that omits a file (older Stryker builds skip files with no mutants) left the key
 *         absent, and the evaluator's `?? 0` read an absent key as a MEASURED zero --
 *         exactly the "not measured looks like measured zero" confusion this module
 *         exists to prevent. Found by review FC-01.
 *
 * @covers AC-GATEM-REPORT-GAPS-01
 */

import { describe, it, expect } from 'vitest';
import { applyMutationResult } from '../gate-m';

const ASKED = ['a.ts', 'b.ts', 'c.ts'];

/** An outcome whose report covers only SOME of the files the run was given. */
function partialOutcome() {
  return {
    timedOut: false,
    report: {
      mutationScore: 50,
      nrOfMutants: 4,
      nrOfKilledMutants: 2,
      nrOfSurvivedMutants: 2,
      files: {
        'a.ts': { mutationScore: 75, nrOfMutants: 4, nrOfKilledMutants: 3, nrOfSurvivedMutants: 1 },
      },
    },
  } as never;
}

describe('applyMutationResult on an incomplete report', () => {
  it('gives every ASKED file a score, null for the ones the report omitted', () => {
    const scores: Record<string, number | null> = {};
    const counts: Record<string, never> = {};
    applyMutationResult(partialOutcome(), ASKED, scores, counts);

    // Present (not absent) with an explicit null: absent plus `?? 0` is a measured zero.
    expect(scores).toHaveProperty('b.ts');
    expect(scores['b.ts']).toBeNull();
    expect(scores).toHaveProperty('c.ts');
    expect(scores['c.ts']).toBeNull();
    expect(scores['a.ts']).toBe(75);
  });

  it('still records the scores the report DID provide', () => {
    const scores: Record<string, number | null> = {};
    applyMutationResult(partialOutcome(), ASKED, scores, {});
    expect(scores['a.ts']).toBe(75);
  });
});
