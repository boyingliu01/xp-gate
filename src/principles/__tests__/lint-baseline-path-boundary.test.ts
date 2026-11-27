/**
 * @test REQ-152-PATH-BOUNDARY
 * @intent A reported path must match a baseline file on a PATH BOUNDARY, not a bare suffix.
 *
 *         `makeFileMatcher` used `f.endsWith(reported)`, and `'src/foobar.ts'` ends with
 *         `'bar.ts'` -- so an eslint report about `bar.ts` claimed `foobar.ts`'s baseline
 *         entry. The counts landed on a file that had no warnings, and the file that DID
 *         had its entry left unused (review MC-01).
 *
 *         A separate file rather than more cases inside `lint-baseline.test.ts`, which is
 *         already at its duplication ceiling; the assertion is about behaviour that file
 *         does not cover.
 *
 * @covers AC-LINT-BASELINE-PATH-BOUNDARY-01
 */

import { describe, it, expect } from 'vitest';
import { parseLintOutput } from '../lint-baseline';

/** Whether an eslint report naming `bar.ts` lands on `candidate`. */
function matches(candidate: string): boolean {
  const report = JSON.stringify([
    {
      filePath: 'bar.ts',
      errorCount: 0,
      warningCount: 1,
      messages: [{ ruleId: 'no-var', severity: 1 }],
    },
  ]);
  return parseLintOutput('eslint', report, [candidate])[candidate] !== undefined;
}

describe('parseLintOutput path matching', () => {
  it('does not match a longer name that merely ends the same way', () => {
    expect(matches('src/foobar.ts')).toBe(false);
  });

  it('still matches a genuine suffix that starts on a boundary', () => {
    expect(matches('src/bar.ts')).toBe(true);
    expect(matches('bar.ts')).toBe(true);
  });
});
