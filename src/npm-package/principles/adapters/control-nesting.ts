/**
 * Control-structure nesting measurement for TypeScript (#749).
 *
 * `clean-code.deep-nesting` asks how deeply a reader must nest to follow a
 * function. Counting braces answers a different question: a config literal such
 * as `{ db: { pool: { retry: { max: 3 } } } }` nests five braces but zero
 * control structures, while `if > try > for > if` nests four. The former
 * `maxNesting` scored both 5, so the rule could not tell a configuration object
 * from logic.
 *
 * Semantics follow lizard's `-ENS` (`cognitive_brace.py`): a level is pushed by
 * the structure that owns a body, `case`/`default` labels are not structures,
 * and a nested function's body belongs to that function's own score.
 *
 * Extracted from `adapters/typescript.ts` to keep that file under the
 * `large-file` budget.
 */

/** The lexical states the scan tracks while counting control structures. */
interface NestingScanState {
  inSingle: boolean;
  inDouble: boolean;
  inTemplate: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

/**
 * Control-structure keywords whose body adds one nesting level.
 *
 * `else` is included because `else if` opens another conditional level: a reader
 * tracks it as nesting, and `-ENS` counts it the same way. `case`/`default` are
 * deliberately absent -- they label arms of a switch, not new levels.
 */
const NESTING_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'try', 'else', 'finally']);

/**
 * Max control-structure nesting in a function body (0 = flat).
 *
 * Accepts either masked or raw source: the scanner carries its own
 * string/comment state machine, so literals and comments are skipped whether or
 * not the caller blanked them first. The adapter is not consistent about this
 * (one call site masks, the arrow path passes raw text), and making the function
 * independent of that choice is what keeps both paths correct.
 *
 * @param body The function body, masked or raw.
 * @returns The deepest control-structure nesting observed.
 */
export function maxControlNesting(body: string): number {
  return nestingOfRange(body, 0, body.length, 0);
}

/**
 * Max nesting found while scanning `body[from, to)`, where `depth` is the number
 * of enclosing control structures already open.
 */
function nestingOfRange(body: string, from: number, to: number, depth: number): number {
  let max = depth;
  const setMax = (value: number): void => { if (value > max) max = value; };
  const state: NestingScanState = {
    inSingle: false,
    inDouble: false,
    inTemplate: false,
    inLineComment: false,
    inBlockComment: false,
  };

  for (let i = from; i < to;) {
    const consumed = advanceNestingState(body, i, state);
    if (consumed === 2) {
      // The pair (escape, comment close, comment open) is consumed whole. A
      // comment opener must not also be read as a brace-less character below.
      i += 2;
      continue;
    }
    if (!isStructuralAt(state)) { i += 1; continue; }
    i = consumeStructure(body, i, to, depth, setMax);
  }
  return max;
}

/**
 * Consume one structural position during a nesting scan.
 *
 * Three things can start here: a control structure (whose body is scanned one
 * level deeper), a nested function (whose body belongs to that function's own
 * score), or an ordinary token. Each returns where the scan resumes.
 */
function consumeStructure(
  body: string, i: number, to: number, depth: number, setMax: (v: number) => void,
): number {
  const word = readWord(body, i);
  if (!word) return i + 1;
  if (NESTING_KEYWORDS.has(word.word) && !isMemberAccess(body, i)) {
    // A control structure owns a nested region: count whatever nests inside it
    // one level deeper, then resume past that region so its braces cannot be
    // mistaken for the enclosing level's.
    const scope = locateControlBody(body, word.end, to);
    setMax(nestingOfRange(body, scope.bodyStart, scope.bodyEnd, depth + 1));
    return scope.bodyEnd;
  }
  if (isNestedFunctionIntro(body, i, word.end)) {
    // A nested function -- named or anonymous -- owns the structures in its own
    // body: the adapter already reports it as its own function, scored there.
    // Skipping it here keeps this function's score from being charged for
    // nesting a reader never sees at this level, and matches lizard's `-ENS`,
    // which attributes a callback's nesting to the callback.
    const brace = findFunctionBodyBrace(body, word.end, to);
    // Expression-bodied (`const f = () => 1;`): no body to skip, so drop only
    // the intro. Skipping a range here would swallow the rest of the function.
    if (brace < 0) return word.end;
    return skipBalancedBrace(body, brace);
  }
  return word.end;
}

/**
 * Locate the payload of a control body starting at `from`.
 *
 * `from` is the position just past the keyword (`consumeStructure` already
 * consumed it), so for `else if (...) {` this starts at the `if` word rather
 * than at `(`. The condition scan below is therefore skipped and the brace-less
 * branch would mis-time the body -- except that `consumeStructure` recurses into
 * the `if` keyword itself and reaches this function again from its own `)`.
 * The body returned here is only the fallback for a structure with no condition.
 *
 * @returns the half-open range to scan at the deeper level.
 */
function locateControlBody(body: string, from: number, to: number): { bodyStart: number; bodyEnd: number } {
  let i = skipSpaces(body, from, to);
  if (body[i] === '(') {
    let parens = 0;
    for (; i < to; i++) {
      if (body[i] === '(') parens++;
      else if (body[i] === ')') {
        parens--;
        if (parens === 0) { i++; break; }
      }
    }
    i = skipSpaces(body, i, to);
  }
  if (body[i] === '{') {
    return { bodyStart: i + 1, bodyEnd: skipBalancedBrace(body, i) - 1 };
  }
  // Brace-less body: it ends at the statement end, which for JavaScript is a
  // newline as much as a `;`. Stopping only at `;` would swallow every following
  // statement of the enclosing block and score sequential guard clauses as
  // nesting.
  let end = i;
  while (end < to && body[end] !== ';' && body[end] !== '\n') end++;
  if (end < to && body[end] === ';') end++;
  return { bodyStart: i, bodyEnd: end };
}

/**
 * True when the token at `wordStart` declares a nested function
 * (`function name(...)`, `const name = async (...) =>`, `= function (...)`).
 *
 * Named functions are scored on their own; the enclosing function is not charged
 * for structures a reader sees inside that separate definition.
 */
function isNestedFunctionIntro(body: string, wordStart: number, wordEnd: number): boolean {
  const current = body.slice(wordStart, wordEnd);
  if (current === 'function') return true;
  // `const name = (...) => {` / `let name = function (...) {`
  let k = wordEnd;
  if (current === 'const' || current === 'let' || current === 'var') {
    const name = readWord(body, skipSpaces(body, k, body.length));
    if (!name) return false;
    k = name.end;
  } else if (!/^[A-Za-z_$][\w$]*$/.test(current)) {
    return false;
  }
  k = skipSpaces(body, k, body.length);
  if (body[k] !== '=') return false;
  k = skipSpaces(body, k + 1, body.length);
  // `const name = async (...) => {` -- the async modifier precedes the params.
  if (body.startsWith('async', k) && !/[\w$]/.test(body[k + 5] ?? '')) {
    k = skipSpaces(body, k + 5, body.length);
  }
  if (body.startsWith('function', k)) return true;
  if (body[k] === '(') {
    const close = skipBalancedParen(body, k);
    return body.startsWith('=>', skipSpaces(body, close, body.length));
  }
  return false;
}

/**
 * Locate the `{` that opens the body of a nested function whose intro ends at
 * `from`.
 *
 * @returns the index of the body's `{`, or `-1` when the body is an expression
 *   with no braces (`const f = () => 1;`). The two cases must be distinguished:
 *   a caller that treated `-1` as `from` would hand a non-brace position to
 *   `skipBalancedBrace`, which then scans to the end of the enclosing function
 *   and silently drops every control structure after the arrow.
 */
function findFunctionBodyBrace(body: string, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (body[i] === '{') return i;
    // No braced body before the statement ends: an expression-bodied arrow or a
    // `function` whose `{` never appears. Report -1 so the caller resumes the
    // scan instead of skipping a bogus range.
    if (body[i] === ';' || body[i] === '}') return -1;
  }
  return -1;
}

/**
 * Count the braces opened between `open` and the matching `}`, returning the
 * index just past the close. `open` must point at a `{`.
 *
 * Braces inside strings, templates and comments are data by then: the caller
 * passes a source that `maskLiterals` has already blanked.
 */
function skipBalancedBrace(body: string, open: number): number {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return body.length;
}

/** Index just past the `)` matching the `(` at `open`. */
function skipBalancedParen(body: string, open: number): number {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return body.length;
}

/** First index at or after `from` that is not whitespace, clamped to `to`. */
function skipSpaces(body: string, from: number, to: number): number {
  let i = from;
  while (i < to && /\s/.test(body[i])) i++;
  return i;
}

/** Read an identifier/keyword token starting at `i`; null when not an identifier. */
function readWord(body: string, i: number): { word: string; end: number } | null {
  const c = body[i];
  if (!/[A-Za-z_$]/.test(c)) return null;
  let j = i + 1;
  while (j < body.length && /[\w$]/.test(body[j])) j++;
  return { word: body.slice(i, j), end: j };
}

/** True when the word at `i` is preceded by `.` (member access, not a keyword). */
function isMemberAccess(body: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /\s/.test(body[k])) k--;
  return k >= 0 && body[k] === '.';
}

/**
 * Advance the quoting/commenting state machine by one character.
 *
 * Pure with respect to depth: it only updates `state` and reports how many
 * characters were consumed, so the counting and the lexing can be reasoned about
 * separately (#602).
 *
 * @returns 2 when a two-character pair was consumed whole, else 1.
 */
function advanceNestingState(body: string, i: number, state: NestingScanState): number {
  const c = body[i];
  const next = body[i + 1];

  if (state.inLineComment) {
    if (c === '\n') state.inLineComment = false;
    return 1;
  }
  if (state.inBlockComment) {
    if (c === '*' && next === '/') { state.inBlockComment = false; return 2; }
    return 1;
  }
  if (state.inSingle) {
    if (c === '\\') return 2;
    if (c === "'") state.inSingle = false;
    return 1;
  }
  if (state.inDouble) {
    if (c === '\\') return 2;
    if (c === '"') state.inDouble = false;
    return 1;
  }
  if (state.inTemplate) {
    if (c === '\\') return 2;
    if (c === '`') state.inTemplate = false;
    return 1;
  }

  if (c === '/' && next === '/') { state.inLineComment = true; return 2; }
  if (c === '/' && next === '*') { state.inBlockComment = true; return 2; }
  if (c === "'") state.inSingle = true;
  else if (c === '"') state.inDouble = true;
  else if (c === '`') state.inTemplate = true;
  return 1;
}

/** True when the current state's character carries structure, not data. */
function isStructuralAt(state: NestingScanState): boolean {
  return !state.inSingle && !state.inDouble && !state.inTemplate
    && !state.inLineComment && !state.inBlockComment;
}
