/**
 * @test quote and position analysis helpers
 * @intent The param-list and brace scanners depend on "is this delimiter inside a
 *         string?" and "is this identifier being called or declared?". Both were
 *         inline in typescript.ts, reached the 1050-line budget, and could not be
 *         tested directly. Extracting them makes each rule checkable on its own.
 * @covers AC-674-01, AC-674-03
 */
import { describe, it, expect } from 'vitest';
import { newQuoteState, inQuotedState, advanceQuoteState, isQuote, applyDelimiter } from '../quote-state';

describe('quote-state', () => {
  it('AC-674-03: tracks each quote kind independently', () => {
    const state = newQuoteState();
    expect(inQuotedState(state)).toBe(false);

    // Opening a single-quoted literal puts us inside one, and the matching
    // quote closes it -- but a DIFFERENT quote kind must not close it.
    expect(advanceQuoteState('"', 0, state)).toBe(1);
    expect(state.inDouble).toBe(true);
    expect(advanceQuoteState("'", 0, state)).toBe(1);
    expect(state.inDouble).toBe(true);
    expect(advanceQuoteState('"', 0, state)).toBe(1);
    expect(state.inDouble).toBe(false);
  });

  it('AC-674-03: an escape consumes two characters and does not close the literal', () => {
    const state = newQuoteState();
    advanceQuoteState("'", 0, state); // open
    expect(advanceQuoteState('\\', 0, state)).toBe(2);
    expect(state.inSingle).toBe(true);
  });

  it('AC-674-03: isQuote recognizes exactly the three quote kinds', () => {
    expect(isQuote("'")).toBe(true);
    expect(isQuote('"')).toBe(true);
    expect(isQuote('`')).toBe(true);
    expect(isQuote('(')).toBe(false);
  });

  it('AC-674-03: delimiters adjust depth and report whether they were one', () => {
    const depth = { value: 0 };
    expect(applyDelimiter('(', depth)).toBe(true);
    expect(depth.value).toBe(1);
    expect(applyDelimiter(')', depth)).toBe(true);
    expect(depth.value).toBe(0);
    // A non-delimiter changes nothing, and says so.
    expect(applyDelimiter(',', depth)).toBe(false);
    expect(depth.value).toBe(0);
  });
});
