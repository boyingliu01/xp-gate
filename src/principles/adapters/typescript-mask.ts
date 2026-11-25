/**
 * Blanking literals and comments out of TypeScript source.
 *
 * Split out of `typescript.ts` when that file crossed its size ceiling. This is the
 * step every structural scan depends on: brace counting only works on source whose
 * strings, comments and regex bodies have been replaced, or a `{` inside a template
 * literal opens a block that never closes.
 *
 * Masking PRESERVES LENGTH: callers map offsets back onto the original text, so a
 * replacement that changed it would shift every position after it.
 */

/**
 * Blank a `//` line comment starting at `start`.
 * Stops AT the newline so line numbering survives (the newline is the caller's
 * to consume as an ordinary character).
 * @returns the index to resume scanning from.
 */
function maskLineComment(src: string, out: string[], start: number): number {
  let i = start;
  while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
  return i;
}

/**
 * Blank a block comment starting at `start` (which holds `/`).
 *
 * #602: newlines inside the comment must survive. Blanking them shifts every
 * subsequent line number, so `lineOf()` and every line-numbered violation after
 * a multi-line comment would point at the wrong line -- exactly the defect the
 * line-comment branch never had, because it stops AT the newline.
 *
 * @returns the index to resume scanning from.
 */
function maskBlockComment(src: string, out: string[], start: number): number {
  let i = start;
  out[i] = ' '; out[i + 1] = ' '; i += 2;
  while (i < src.length && !closesBlockComment(src, i)) {
    // NEWLINES are kept: the masker preserves line count, and a caller reporting a
    // position depends on it.
    if (src[i] !== '\n') out[i] = ' ';
    i++;
  }
  if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
  return i;
}

/** Whether the block comment closes at `i`. */
function closesBlockComment(src: string, i: number): boolean {
  return src[i] === '*' && src[i + 1] === '/';
}

/**
 * Decide whether the `/` at `index` opens a regex literal rather than being
 * division. A regex may only start where an expression may start: at the very
 * beginning, after an operator/punctuation, or after a keyword that expects an
 * expression (`return /re/`, `typeof /re/`, ...).
 */
function opensRegexLiteral(src: string, index: number): boolean {
  const before = src.substring(0, index).replace(/\s+$/, '');
  const prev = before[before.length - 1];
  if (prev === undefined) return true;
  if (/[=(,:[!&|?{};+\-*%^~<>]/.test(prev)) return true;
  return /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|instanceof)$/.test(before);
}

/**
 * Find where a regex literal starting at `start` closes, honouring `\` escapes
 * and character classes (`[/]` must not close the literal).
 * @returns the index of the closing `/`, or -1 when the line ends first (so the
 *          slash really was division).
 */
/** What the regex scanner should do with one character. */
type RegexStep =
  | { kind: 'close'; at: number }
  | { kind: 'stop' }
  | { kind: 'skip'; extra: number }
  | { kind: 'class'; value: boolean }
  | { kind: 'continue' };

/**
 * Classify one character inside a regex literal body.
 *
 * `[/]` is a CLASS containing a slash, not a closing delimiter -- which is why the
 * `[`/`]` state has to be tracked. A backslash escapes the NEXT character, so it
 * consumes two.
 */
/** Characters whose meaning inside a regex body is fixed. */
const REGEX_CHAR_STEPS: Record<string, RegexStep> = {
  '\\': { kind: 'skip', extra: 1 },
  '\n': { kind: 'stop' },
  '[': { kind: 'class', value: true },
  ']': { kind: 'class', value: false },
};

function classifyRegexChar(d: string, inClass: boolean, at: number): RegexStep {
  const fixed = REGEX_CHAR_STEPS[d];
  if (fixed) return fixed;
  // A `/` closes the literal only OUTSIDE a character class.
  return d === '/' && !inClass ? { kind: 'close', at } : { kind: 'continue' };
}

/**
 * The index of the `/` that closes a regex literal opening before `start`.
 *
 * @returns the index, or -1 when the literal is unterminated on its line
 */
function findRegexClose(src: string, start: number): number {
  const state = { inClass: false };
  for (let j = start + 1; j < src.length; j++) {
    const step = classifyRegexChar(src[j], state.inClass, j);
    if (step.kind === 'stop') return -1;
    if (step.kind === 'close') return step.at;
    j = applyRegexStep(step, j, state);
  }
  return -1;
}

/**
 * Apply a non-terminal step and return the index to continue from.
 *
 * `skip` consumes the escaped character as well (`\/` is a literal slash); `class`
 * flips the bracket state. Both leave the scan running.
 */
function applyRegexStep(step: RegexStep, j: number, state: { inClass: boolean }): number {
  if (step.kind === 'skip') return j + step.extra;
  if (step.kind === 'class') state.inClass = step.value;
  return j;
}

/**
 * Blank a regex literal (and its trailing flags) starting at `start`.
 * @returns the index to resume scanning from.
 */
function maskRegexLiteral(src: string, out: string[], start: number): number {
  const close = findRegexClose(src, start);
  if (close < 0) return start;
  for (let k = start; k <= close; k++) out[k] = ' ';
  let i = close + 1;
  while (i < src.length && /[a-z]/i.test(src[i])) { out[i] = ' '; i++; }
  return i;
}

/**
 * Blank a quoted or template literal starting at `start`.
 * A backtick runs to its closing backtick (interpolations included); a single
 * or double quote stops at an unescaped newline, matching a syntax error.
 * @returns the index to resume scanning from.
 */
function maskStringLiteral(src: string, out: string[], start: number): number {
  const quote = src[start];
  out[start] = ' ';
  let i = start + 1;
  while (i < src.length) {
    const step = stringStep(src, i, quote);
    out.fill(' ', i, clampToLength(step.end, out.length));
    i = step.end;
    if (step.done) break;
  }
  return i;
}


/** `to`, never past `length`. */
function clampToLength(to: number, length: number): number {
  return Math.min(to, length);
}

/**
 * How far a string body advances from `i`, and whether it ended.
 *
 * An ESCAPED character consumes two: `\\` and the character after it are content, so a
 * `\"` inside a double-quoted string does not terminate it. A newline ends the literal
 * for every quote but the backtick, which spans lines.
 */
function stringStep(src: string, i: number, quote: string): { end: number; done: boolean } {
  const d = src[i];
  if (d === '\\') return { end: Math.min(i + 2, src.length), done: false };
  if (d === quote) return { end: i + 1, done: true };
  if (d === '\n' && quote !== '`') return { end: i, done: true };
  return { end: i + 1, done: false };
}

/**
 * Blank out comments and string/template literals, preserving offsets.
 * A single left-to-right scan is used rather than chained `.replace()` calls:
 * sequential regex replacement re-scans text that earlier passes produced and
 * can pair a quote inside a regex literal with a quote in a later comment,
 * swallowing hundreds of lines (observed as a 302-line phantom function).
 *
 * The scan dispatches to one masking routine per construct and otherwise copies
 * the character through, so the loop's own branching stays flat (#602: split
 * from a single 36-CCN body into five routines the tests can pin separately).
 */
/**
 * The maskers, asked in order at each index.
 *
 * A comment opener must be tried before a regex: `/` starts both, and `//` after a
 * paren is a comment rather than the beginning of one. A masker returns the next index
 * to examine, or -1 when the construct it recognises is not actually there.
 */
const LITERAL_MASKERS: Array<(src: string, out: string[], i: number) => number> = [
  maskCommentAt,
  maskRegexAt,
  maskStringAt,
];

/**
 * Blank out every comment, regex and string body, keeping the source LENGTH.
 *
 * Positions have to survive masking: the caller maps offsets back onto the original
 * text (to read a function's real extent, for instance), so a replacement that changed
 * the length would shift everything after it.
 */
function maskLiterals(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const next = nextMaskedIndex(src, out, i);
    i = next > i ? next : i + 1;
  }
  return out.join('');
}

/**
 * The index a masker says to resume from, or `i` when none of them applies.
 *
 * Taking the first masker that ADVANCES (rather than the first that matches) is what
 * keeps `i` moving: a masker that recognises the opening but cannot find the end
 * returns -1, and the scan must then treat the character as ordinary code.
 */
function nextMaskedIndex(src: string, out: string[], i: number): number {
  for (const mask of LITERAL_MASKERS) {
    const resumed = mask(src, out, i);
    if (resumed > i) return resumed;
  }
  return i;
}

/** `//` and block comments. */
function maskCommentAt(src: string, out: string[], i: number): number {
  if (src[i] !== '/') return -1;
  if (src[i + 1] === '/') return maskLineComment(src, out, i);
  if (src[i + 1] === '*') return maskBlockComment(src, out, i);
  return -1;
}

/** A regex literal, only where an expression may start. */
function maskRegexAt(src: string, out: string[], i: number): number {
  if (src[i] !== '/' || !opensRegexLiteral(src, i)) return -1;
  return maskRegexLiteral(src, out, i);
}

/** A single-, double- or back-quoted run. */
function maskStringAt(src: string, out: string[], i: number): number {
  const c = src[i];
  if (c !== "'" && c !== '"' && c !== '`') return -1;
  return maskStringLiteral(src, out, i);
}

export {
  maskLiterals,
};
