/**
 * @test REQ-DELPHI-JSON-BALANCED
 * @intent The extractor must pull out the FIRST balanced object, not the longest span.
 *
 *         `FIRST_OBJECT = /\{[\s\S]*\}/` is greedy: an answer containing two objects became
 *         one span from the first `{` to the LAST `}`, which is not JSON -- while the first
 *         object on its own would have parsed. A model that says "the verdict is {...},
 *         for reference see {...}" lost an answer that was right there (review MC-01).
 *
 * @covers AC-DELPHI-JSON-BALANCED-01
 */

'use strict';

const { extractJsonFromResponse } = require('../delphi-json-extract.cjs');

describe('extractJsonFromResponse brace matching', () => {
  it('takes the FIRST of several objects instead of spanning to the last brace', () => {
    const out = extractJsonFromResponse('the verdict is {"verdict":"APPROVED"} see also {"note":"x"}');
    expect(out).toEqual({ verdict: 'APPROVED' });
  });

  it('does not let a brace inside a string move the depth', () => {
    // `"}"` is data; a depth counter that ignores quotes would close the object there.
    expect(extractJsonFromResponse('{"a":"}","b":1}')).toEqual({ a: '}', b: 1 });
  });

  it('still handles a nested object', () => {
    expect(extractJsonFromResponse('x {"a":{"b":{"c":1}}}')).toEqual({ a: { b: { c: 1 } } });
  });

  it('reports a parse error when no balanced object exists', () => {
    const out = extractJsonFromResponse('{"unterminated": ');
    expect(out.parse_error).toBe(true);
  });
});
