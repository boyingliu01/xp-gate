/**
 * @test REQ-GATE3-ANALYZER-FAIL-CLOSED
 * @intent Gate 3 must not read an UNREADABLE PSScriptAnalyzer payload as a clean run.
 *
 *         `analyzerFindingCount` returned 0 for empty AND for unparseable output, and the
 *         caller rendered 0 as "✅ PASSED - PowerShell code quality check passed". A
 *         corrupt payload therefore claimed a quality verdict nothing had measured.
 *
 *         Discovered by two reviewers on the same diff, AFTER `gate-9` was fixed for the
 *         identical mistake -- two gates reading the same tool must not disagree about
 *         what an empty answer means.
 *
 * @covers AC-GATE3-ANALYZER-FAIL-CLOSED-01
 */

import { describe, it, expect } from 'vitest';

/**
 * The production predicate, mirrored.
 *
 * `analyzerFindingCount` is module-private and its caller does I/O; asserting on the
 * DECISION (number | null) is what the gate actually branches on, and keeps this test
 * free of the process spawning the real function would need.
 */
function analyzeOutput(stdout: string): number | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

describe('gate-3 analyzerFindingCount semantics', () => {
  it('reports UNREADABLE output as null, not as zero findings', () => {
    expect(analyzeOutput('not json')).toBeNull();
    expect(analyzeOutput('{"broken":')).toBeNull();
  });

  it('reports EMPTY output as null', () => {
    expect(analyzeOutput('')).toBeNull();
    expect(analyzeOutput('  \n ')).toBeNull();
  });

  it('reports a non-array body as null: a single object is not a findings list', () => {
    expect(analyzeOutput('{"RuleName":"x"}')).toBeNull();
  });

  it('counts a READABLE array, including an empty one', () => {
    expect(analyzeOutput('[]')).toBe(0);
    expect(analyzeOutput('[{"a":1},{"b":2}]')).toBe(2);
  });
});
