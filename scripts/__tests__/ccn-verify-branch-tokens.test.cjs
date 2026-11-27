/**
 * @test REQ-CCN-VERIFY-BRANCH-TOKENS
 * @intent The CCN verifier must not count TypeScript's TYPE-level `?` as a branch.
 *
 *         `BRANCH_RE`'s ternary arm was `\?[^.]`, which also matches the optional marker in
 *         `key?: string` and `f(a?: number)`. Every optional property in an interface
 *         therefore raised the recomputed CCN, and the verifier "corrected" a number that
 *         was right -- the most dangerous direction for a measurement tool: a confident
 *         wrong answer (review MC-02).
 *
 *         `stripNonCode` has already removed strings and comments, so a surviving `?` is a
 *         ternary or one of the three type-level markers, and only the ternary is a branch.
 *
 * @covers AC-CCN-VERIFY-BRANCH-TOKENS-01
 */

'use strict';

const { ccnOfBody } = require('../ccn-verify.cjs');

describe('ccnOfBody and TypeScript optional markers', () => {
  it('does not count `key?: type` as a branch', () => {
    // Two optional properties, no control flow at all: CCN must stay at the base of 1.
    expect(ccnOfBody(['interface T {', '  a?: string', '  b?: number', '}'])).toBe(1);
  });

  it('does not count an optional PARAMETER as a branch', () => {
    expect(ccnOfBody(['function f(a?: number, b?: string) {', '  return a;', '}'])).toBe(1);
  });

  it('does not count optional chaining as a branch', () => {
    expect(ccnOfBody(['const v = obj?.a?.b;'])).toBe(1);
  });

  it('STILL counts a real ternary', () => {
    expect(ccnOfBody(['const v = a ? b : c;'])).toBe(2);
  });

  it('STILL counts if/for/while and the logical operators', () => {
    expect(ccnOfBody(['if (a && b) { }'])).toBe(3); // +1 if, +1 &&
    expect(ccnOfBody(['for (const x of xs) { }'])).toBe(2);
  });

  it('does not count a PROPERTY named like a keyword', () => {
    // `obj.if` is not a branch. The word boundary alone matched it, inflating CCN on
    // ordinary code (review CC-02).
    expect(ccnOfBody(['obj.if = 1;'])).toBe(1);
  });

  it('does not count an OBJECT KEY named like a keyword', () => {
    expect(ccnOfBody(['const o = { while: 1 };'])).toBe(1);
  });

  it('still counts a real case label, whose colon comes after the expression', () => {
    expect(ccnOfBody(['switch (x) { case 1: break; }'])).toBe(2);
  });
});
