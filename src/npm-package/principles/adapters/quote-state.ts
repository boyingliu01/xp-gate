/**
 * Character-level quote and delimiter tracking for TypeScript source scanning.
 *
 * The param-list and brace scanners all need "is this delimiter inside a string
 * or template?" before they can act on it. That logic is identical for every
 * caller, so it lives here instead of being repeated -- and it keeps
 * `typescript.ts` inside the 1050-line budget.
 */

export interface QuoteState {
  inSingle: boolean;
  inDouble: boolean;
  inTemplate: boolean;
}

export function newQuoteState(): QuoteState {
  return { inSingle: false, inDouble: false, inTemplate: false };
}

export function inQuotedState(state: QuoteState): boolean {
  return state.inSingle || state.inDouble || state.inTemplate;
}

/** The three quote kinds tracked by QuoteState, with the flag that marks each. */
const QUOTE_KINDS: ReadonlyArray<{ quote: string; flag: 'inSingle' | 'inDouble' | 'inTemplate' }> = [
  { quote: "'", flag: 'inSingle' },
  { quote: '"', flag: 'inDouble' },
  { quote: '`', flag: 'inTemplate' },
];

/**
 * Advance one character of quote tracking.
 *
 * Extracted because `countParams` and `readParenGroup` carried the same
 * six-branch block verbatim (#602): both must ignore delimiters that appear
 * inside a string, and neither may treat an escape as a closing quote.
 *
 * Table-driven (#620): all three quote kinds behave identically -- an escape
 * skips two characters, the matching quote closes the literal -- so they are one
 * rule applied to a list rather than three copies of it.
 *
 * @returns the number of characters consumed (2 when the next char is escaped).
 */
export function advanceQuoteState(src: string, i: number, state: QuoteState): number {
  const c = src[i];

  for (const kind of QUOTE_KINDS) {
    if (!state[kind.flag]) continue;
    if (c === '\\') return 2;
    if (c === kind.quote) state[kind.flag] = false;
    return 1;
  }

  // Not inside any literal: open the one this character starts, if any.
  const opener = QUOTE_KINDS.find(kind => kind.quote === c);
  if (opener) state[opener.flag] = true;
  return 1;
}

/** Opening delimiters that raise the generic/bracket depth in a param list. */
const DEPTH_OPENERS = new Set(['(', '[', '{', '<']);
/** Closing delimiters that lower it. */
const DEPTH_CLOSERS = new Set([')', ']', '}', '>']);

/**
 * Adjust `depth` for one delimiter.
 * @returns true when the character was a delimiter (so it cannot also be a
 *          separator), false otherwise.
 */
export function applyDelimiter(c: string, depth: { value: number }): boolean {
  if (DEPTH_OPENERS.has(c)) { depth.value++; return true; }
  if (DEPTH_CLOSERS.has(c)) { depth.value--; return true; }
  return false;
}

/** True when the character opens a quote/template the scanners must skip. */
export function isQuote(c: string): boolean {
  return c === "'" || c === '"' || c === '`';
}

