/**
 * @test REQ-GATE9-ANALYZER-FAIL-CLOSED
 * @intent Gate 9 must not read an UNREADABLE analyzer payload as a clean repository.
 *
 *         `parseAnalyzerOutput` returned `[]` both for "the analyzer printed nothing" and
 *         for "the analyzer printed something that is not JSON", and the caller rendered
 *         `[]` as PASS. A corrupted or truncated payload therefore reported "No PowerShell
 *         security vulnerabilities found" -- a verdict about a scan that never happened.
 *
 *         Two reviewers found this independently on the same diff, which is why the
 *         assertion is about the DISTINCTION: empty is a possible clean run, unreadable
 *         is not, and only the caller knows what to do with each.
 *
 * @covers AC-GATE9-ANALYZER-FAIL-CLOSED-01
 */

import { describe, it, expect } from 'vitest';
import { parseAnalyzerOutput } from '../gate-9';

describe('gate-9 parseAnalyzerOutput', () => {
  it('returns null for UNREADABLE output so the caller can WARN', () => {
    // Not `[]`: that is indistinguishable from a clean scan.
    expect(parseAnalyzerOutput('not json at all')).toBeNull();
    expect(parseAnalyzerOutput('{"truncated":')).toBeNull();
  });

  it('returns null for EMPTY output, which is also unmeasurable', () => {
    expect(parseAnalyzerOutput('')).toBeNull();
    expect(parseAnalyzerOutput('   \n  ')).toBeNull();
  });

  it('parses a single finding object', () => {
    const one = { RuleName: 'PSUseShouldProcessForStateChangingFunctions', Severity: 'Warning' };
    expect(parseAnalyzerOutput(JSON.stringify(one))).toEqual([one]);
  });

  it('parses an array of findings', () => {
    const many = [{ RuleName: 'A' }, { RuleName: 'B' }];
    expect(parseAnalyzerOutput(JSON.stringify(many))).toEqual(many);
  });

  it('returns an empty array for a READABLE empty result', () => {
    // `[]` IS a real answer from the analyzer: it ran and found nothing.
    expect(parseAnalyzerOutput('[]')).toEqual([]);
  });
});
