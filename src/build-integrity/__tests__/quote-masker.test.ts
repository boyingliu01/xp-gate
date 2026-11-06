/**
 * @test The quote/comment masker's own contract (#759)
 * @intent Assert the masker's three positional invariants directly instead of
 *         inferring them from extractImports' output. A shorter result shifts
 *         every later line number, a lost newline collapses lines, and a
 *         surviving quote re-opens the exact hole #759 closed — each is a
 *         silent failure, so each is pinned here.
 * @covers maskTextQuotes, maskTextQuotesForTest
 */

import { describe, it, expect } from 'vitest';
import { maskTextQuotesForTest } from '../quote-masker';

/**
 * Every other test drives `extractImports` and infers the masker's
 * behaviour from the paths that come out. These assert the three properties the
 * masker promises directly, because each is a silent-failure class on its own:
 * a shorter output shifts every later line number, a lost newline collapses
 * lines, and a surviving quote re-opens the exact bug #759 fixed.
 */
describe('maskTextQuotes contract', () => {
  const BS = String.fromCharCode(92);
  const BT = String.fromCharCode(96);
  const SQ = String.fromCharCode(39);
  const SAMPLES: Array<[string, string]> = [
    ['plain code', "import x from './x';"],
    ['single-quoted string', "const a = 'hello';"],
    ['double-quoted string', 'const b = "hello";'],
    ['template literal', 'const c = ' + BT + 'hello' + BT + ';'],
    ['nested interpolation', 'const d = ' + BT + '${' + BT + '${v}' + BT + '}' + BT + ';'],
    ['line comment', "// import x from './x'"],
    ['block comment', "/* import x from './x' */"],
    ['escaped quote', 'const e = ' + BS + '"'],
    ['line continuation', "const f = 'a" + BS + "\nb';"],
    ['regex literal', 'const g = /ab+c/;'],
    ['trailing backslash', 'const h = ' + BS],
    // Unbalanced delimiters: the masker must never throw and never grow or
    // shrink the text, even when the file simply ends mid-literal. Every one of
    // these is a shape a truncated or generated file really contains.
    ['unterminated single quote', "const i = 'abc"],
    ['unterminated double quote', 'const j = "abc'],
    ['unterminated template', 'const k = ' + BT + 'abc'],
    ['unterminated block comment', 'const l = 1; /* abc'],
    ['unterminated interpolation', 'const m = ' + BT + '${'],
    ['regex holding a quote', 'const n = /' + SQ + '/;'],
    ['empty input', ''],
  ];

  it.each(SAMPLES)('preserves length for %s', (_label, sample) => {
    expect(maskTextQuotesForTest(sample).length).toBe(sample.length);
  });

  it.each(SAMPLES)('preserves the newline count for %s', (_label, sample) => {
    const countNewlines = (s: string): number => s.split(String.fromCharCode(10)).length;
    expect(countNewlines(maskTextQuotesForTest(sample))).toBe(countNewlines(sample));
  });

  it('leaves no raw quote inside masked text', () => {
    // The DELIMITERS survive (they are real code); what must not survive is a
    // quote INSIDE a literal or comment, which is what would let the import
    // regexes see pseudo-code. Asserting "no quote anywhere" would be wrong —
    // the opening quote is code.
    const content = "const a = 'it\"s \"x\"'; // 'another'";
    const masked = maskTextQuotesForTest(content);
    // Everything from the opening delimiter to the end of the line is either
    // the delimiter itself, a sentinel, or a space.
    const open = masked.indexOf("'");
    expect(open).toBeGreaterThan(-1);
    // The doubled-quote body keeps ONE extra delimiter; every other quote inside
    // the literal must be a sentinel.
    const seen = new Set(masked.slice(open + 1));
    expect(seen.has('"')).toBe(false);
    // The comment's quote must not survive either.
    expect(masked.split("'").length - 1).toBe(2);
  });

  it('is idempotent in length when applied twice', () => {
    // The masker is not a fixed point of itself (masking a masked string masks
    // its sentinels), but it must never grow or shrink the text.
    const content = "const a = 'x'; import y from './y';";
    const once = maskTextQuotesForTest(content);
    expect(maskTextQuotesForTest(once).length).toBe(content.length);
  });

  it('never throws on any sample, including unbalanced delimiters', () => {
    // `extractImports` runs over arbitrary real files, and a truncated file or a
    // generated artefact can end mid-literal. A throw here would abort Gate 10
    // for the whole file rather than mis-report one line, so this is checked
    // across every sample rather than one representative case.
    for (const [label, sample] of SAMPLES) {
      expect(() => maskTextQuotesForTest(sample), label).not.toThrow();
    }
  });

  it('never throws on a lone sentinel byte in the input', () => {
    // QUOTE_SENTINEL is a NUL character. Source containing a literal NUL is
    // unusual but legal in a string, and the masker must not treat it as
    // anything special.
    const NUL = String.fromCharCode(0);
    const content = "const a = '" + NUL + "'; import y from './y';";
    expect(() => maskTextQuotesForTest(content)).not.toThrow();
    expect(maskTextQuotesForTest(content).length).toBe(content.length);
  });
});
