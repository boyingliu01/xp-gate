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
 * The brace pairing below (`skipBalancedBrace`, `skipBalancedParen`) counts raw
 * characters, so a `}` or `)` inside a string literal unbalances it. Callers
 * MUST pass a source whose string/template/comment contents are already blanked
 * (`maskLiterals`). The keyword state machine does skip comments and literals on
 * its own, but that does not rescue the brace pairing -- masking is required,
 * not optional.
 *
 * @param body The function body from `maskLiterals`.
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
  // Anonymous arrow with a parenthesized parameter list: `items.map((x) => {`.
  // The scan reaches `(` before any word, so this has to be checked here rather
  // than in isNestedFunctionIntro. Without it the parenthesized form is charged
  // to the enclosing function while `x => {` is not -- the same construct scored
  // two different ways (#749 walkthrough).
  if (body[i] === '(') {
    const close = skipBalancedParen(body, i);
    // A return-type annotation may sit between the parameter list and `=>`
    // (`items.map((x): { ok: boolean } => { ... })`). Skip past it so the arrow
    // is still recognized and its body is not charged to the enclosing function.
    const afterParams = skipArrowReturnType(body, close, to);
    if (body.startsWith('=>', afterParams)) {
      const brace = findFunctionBodyBrace(body, afterParams, to);
      return brace < 0 ? afterParams : skipBalancedBrace(body, brace);
    }
  }
  const word = readWord(body, i);
  if (!word) return i + 1;
  if (NESTING_KEYWORDS.has(word.word) && !isMemberAccess(body, i) && !isKeyOrLabel(body, word.end)) {
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
  // Brace-less body. When the body is itself a control structure, the region to
  // scan starts at that structure's keyword and ends where its own body ends --
  // each level then adds its own +1 as the scan descends, so `if (a)\n if (b)\n
  // if (c) { }` nests three deep. Returning the innermost range directly would
  // skip the intermediate levels. A trailing `else` belongs to that inner `if`
  // (`if (a) if (b) { } else { }`), so it is included or the `else` body would be
  // rescanned at the outer depth.
  const head = readWord(body, i);
  if (head && NESTING_KEYWORDS.has(head.word) && !isMemberAccess(body, i) && !isKeyOrLabel(body, head.end)) {
    const inner = locateControlBody(body, head.end, to);
    // `inner.bodyEnd` is inclusive of the closing `}`, so step past it before
    // looking for a trailing `else`/`catch`/`finally`.
    let afterInner = inner.bodyEnd;
    if (body[afterInner] === '}') afterInner++;
    afterInner = skipSpaces(body, afterInner, to);
    const tail = readWord(body, afterInner);
    if (tail && (tail.word === 'else' || tail.word === 'catch' || tail.word === 'finally')) {
      return { bodyStart: i, bodyEnd: locateControlBody(body, tail.end, to).bodyEnd };
    }
    return { bodyStart: i, bodyEnd: inner.bodyEnd };
  }
  // Otherwise it ends at the statement end, which for JavaScript is a newline as
  // much as a `;`. Stopping only at `;` would swallow every following statement
  // and score sequential guard clauses as nesting.
  let end = i;
  while (end < to && body[end] !== ';' && body[end] !== '\n') end++;
  if (end < to && body[end] === ';') end++;
  return { bodyStart: i, bodyEnd: end };
}

/**
 * True when the parameter list starting at `open` is followed by a method body
 * or return-type annotation -- i.e. method shorthand rather than a call.
 */
function isMethodSignature(body: string, open: number): boolean {
  const close = skipSpaces(body, skipBalancedParen(body, open), body.length);
  return body[close] === '{' || body[close] === ':';
}

/** Index just past the balanced `<...>` at `open`, or `open` when unbalanced. */
function skipBalancedAngle(body: string, open: number): number {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '<') depth++;
    else if (body[i] === '>') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return open;
}

/**
 * True when the word at `wordStart` declares a nested function
 * (`function name(...)`, `const name = async (...) =>`, `= function (...)`).
 *
 * Named functions are scored on their own; the enclosing function is not charged
 * for structures a reader sees inside that separate definition.
 */
function isNestedFunctionIntro(body: string, wordStart: number, wordEnd: number): boolean {
  const current = body.slice(wordStart, wordEnd);
  if (current === 'function') return true;
  const afterWord = skipSpaces(body, wordEnd, body.length);
  // Unparenthesized single-parameter arrow: `items.map(x => { ... })`,
  // `async x => { ... }`. Without this the callback's nesting is charged to the
  // enclosing function, while the parenthesized form is skipped correctly -- the
  // same construct scored two different ways.
  if (body.startsWith('=>', afterWord)) return true;
  // Method shorthand: `{ m() { } }`, `m(): void { }`, `m<T>() { }`. lizard -ENS
  // reports the method as its own function and the enclosing body as 0.
  if (body[afterWord] === '(' && isMethodSignature(body, afterWord)) return true;
  if (body[afterWord] === '<') {
    const afterGeneric = skipSpaces(body, skipBalancedAngle(body, afterWord), body.length);
    if (body[afterGeneric] === '(' && isMethodSignature(body, afterGeneric)) return true;
  }
  return isAssignedFunctionIntro(body, current, wordEnd);
}

/**
 * True for `const name = (...) => {` / `let name = function (...) {` /
 * `x = async () => {`, where the value assigned at `wordEnd` is a function.
 */
function isAssignedFunctionIntro(body: string, current: string, wordEnd: number): boolean {
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
  if (body[k] !== '(') return false;
  const close = skipBalancedParen(body, k);
  return body.startsWith('=>', skipArrowReturnType(body, close, body.length));
}

/**
 * Locate the `{` that opens the body of a nested function whose intro ends at
 * `from`.
 *
 * A destructured or defaulted parameter carries braces of its own
 * (`const h = ({id}) => {`, `function f(a = {}) {`), so the parameter list is
 * skipped first -- otherwise the parameter's brace is mistaken for the body and
 * the real body is charged to the enclosing function.
 *
 * @returns the index of the body's `{`, or `-1` when the body is an expression
 *   with no braces (`const f = () => 1;`). The two cases must be distinguished:
 *   a caller that treated `-1` as `from` would hand a non-brace position to
 *   `skipBalancedBrace`, which then scans to the end of the enclosing function
 *   and silently drops every control structure after the arrow.
 */
function findFunctionBodyBrace(body: string, from: number, to: number): number {
  // Walk to the parameters (if any) and step over the whole list, including
  // nested braces inside it.
  let start = from;
  for (; start < to; start++) {
    if (body[start] === '(' || body[start] === '{' || body[start] === ';') break;
  }
  let i = start;
  if (body[i] === '(') i = skipSpaces(body, skipBalancedParen(body, i), to);
  for (; i < to; i++) {
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

/**
 * Index just past an arrow's return-type annotation, when one is present.
 *
 * `(x): number =>` and `(x): { ok: boolean } =>` both put a type between the
 * parameter list and `=>`. Skips a `:`-introduced type (walking balanced `{}`
 * and `<>` inside it) so the arrow is still recognized.
 */
function skipArrowReturnType(body: string, from: number, to: number): number {
  const start = skipSpaces(body, from, to);
  if (body[start] !== ':') return start;
  return scanTypeTo(body, start + 1, to);
}

/** How one character of a type annotation affects the type scan. */
type TypeScanStep = 'stop' | 'open-brace' | 'close-brace' | 'open-angle' | 'close-angle' | 'skip';

function classifyTypeChar(body: string, i: number, braces: number, angles: number): TypeScanStep {
  const c = body[i];
  if (c === '{') return 'open-brace';
  // A `}` at depth 0 closes the enclosing block, so the type cannot extend past it.
  if (c === '}') return braces === 0 ? 'stop' : 'close-brace';
  if (c === '<') return 'open-angle';
  if (c === '>' && angles > 0) return 'close-angle';
  const flat = braces === 0 && angles === 0;
  if (flat && c === '=' && body[i + 1] === '>') return 'stop';
  if (flat && (c === ';' || c === '\n')) return 'stop';
  return 'skip';
}

/** Depth adjustment for one step of a type scan. */
function typeDepthDelta(step: TypeScanStep): { braces: number; angles: number } {
  if (step === 'open-brace') return { braces: 1, angles: 0 };
  if (step === 'close-brace') return { braces: -1, angles: 0 };
  if (step === 'open-angle') return { braces: 0, angles: 1 };
  if (step === 'close-angle') return { braces: 0, angles: -1 };
  return { braces: 0, angles: 0 };
}

/** Scan a type annotation, returning the index of the `=>` (or terminator). */
function scanTypeTo(body: string, from: number, to: number): number {
  let braces = 0;
  let angles = 0;
  for (let i = from; i < to; i++) {
    const step = classifyTypeChar(body, i, braces, angles);
    if (step === 'stop') return i;
    const delta = typeDepthDelta(step);
    braces += delta.braces;
    angles += delta.angles;
  }
  return to;
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
 * True when the word spanning `[start, end)` is an object key or a labeled
 * statement rather than a control keyword: `{ for: 1 }`, `{ try: t }`, `o = { if: 1 }`.
 *
 * A control keyword is followed by `(` or `{` (`else` by `{` or `if`), never by
 * `:`. The colon has to be checked immediately after the word so a real ternary
 * or a typed arrow body is not caught, and the word must end a token so `forEach`
 * is unaffected.
 */
function isKeyOrLabel(body: string, end: number): boolean {
  const next = skipSpaces(body, end, body.length);
  return body[next] === ':';
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
