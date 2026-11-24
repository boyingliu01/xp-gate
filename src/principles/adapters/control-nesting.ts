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
 * True when the string/template/comment contents still contain unbalanced
 * braces -- evidence that `maskLiterals` was skipped. A masked body cannot have
 * a `{` or `}` inside a literal, so any imbalance is a masking gap.
 *
 * Braces are checked rather than parens because they are what the scanner's
 * block pairing depends on. A paren check would additionally fire on
 * `maskLiterals`' own gaps (it misses regex literals inside array literals, whose
 * escaped `\(` reads as an open paren), which is a separate defect: widening the
 * assertion here would turn that gap into a crash on valid code.
 */
function hasUnbalancedBraces(body: string): boolean {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

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
 * Unbalanced braces are rejected rather than scored: `skipBalancedBrace` returns
 * the end of input when it never finds the close, so an unmasked body would
 * silently swallow every following control structure and report an artificially
 * low nesting score. A wrong number that looks like a clean result is the worst
 * possible outcome for a quality gate, so this fails loudly instead.
 *
 * @param body The function body from `maskLiterals`.
 * @returns The deepest control-structure nesting observed.
 * @throws RangeError when `body` still contains unbalanced braces (unmasked).
 */
export function maxControlNesting(body: string): number {
  if (hasUnbalancedBraces(body)) {
    throw new RangeError(
      'maxControlNesting requires masked input: unbalanced braces, so a literal '
      + 'was not blanked. Pass maskLiterals(body) instead of raw source.',
    );
  }
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
    if (consumed === PAIR_CONSUMED) {
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
  const start = skipControlHeader(body, from, to);
  const braced = bracedBody(body, start);
  return braced || bareBody(body, start, to);
}

/**
 * Step past the modifier and condition list: optional `await`, then `(...)`.
 *
 * `for await (...)` puts the modifier between the keyword and the condition. Without
 * skipping it the loop body looked brace-less and was cut at the newline, losing a
 * level.
 *
 * @returns the index of the first character after the header
 */
function skipControlHeader(body: string, from: number, to: number): number {
  let i = skipSpaces(body, from, to);
  if (body.startsWith('await', i) && !/[\w$]/.test(body[i + 5] ?? '')) {
    i = skipSpaces(body, i + 5, to);
  }
  if (body[i] !== '(') return i;
  return skipSpaces(body, skipBalancedParen(body, i), to);
}

/**
 * The region inside a `{ ... }` body, or null when the body is brace-less.
 */
function bracedBody(body: string, start: number): { bodyStart: number; bodyEnd: number } | null {
  if (body[start] !== '{') return null;
  return { bodyStart: start + 1, bodyEnd: skipBalancedBrace(body, start) - 1 };
}

/**
 * The region of a brace-less body.
 *
 * When the body is itself a control structure, the region starts at that structure's
 * keyword and ends where its own body ends -- each level adds its own +1 as the scan
 * descends, so three nested single-statement `if`s nest three deep. Returning the
 * innermost range directly would skip the intermediate levels.
 */
function bareBody(body: string, start: number, to: number): { bodyStart: number; bodyEnd: number } {
  return nestedControlBody(body, start, to) || statementBody(body, start, to);
}

/**
 * A nested control structure as the body, or null when this is not one.
 *
 * A trailing `else` belongs to the inner structure (`if (a) if (b) { } else { }`), so
 * it is included -- otherwise the `else` body would be rescanned at the outer depth.
 */
function nestedControlBody(body: string, start: number, to: number): { bodyStart: number; bodyEnd: number } | null {
  const head = readWord(body, start);
  if (!head || !isNestingHead(body, head, start)) return null;

  const inner = locateControlBody(body, head.end, to);
  const tail = trailingClause(body, inner.bodyEnd, to);
  if (!tail) return { bodyStart: start, bodyEnd: inner.bodyEnd };
  return { bodyStart: start, bodyEnd: locateControlBody(body, tail.end, to).bodyEnd };
}

/**
 * A statement body: ends at a semicolon or a newline, both of which terminate a
 * JavaScript statement here. Stopping only at the semicolon would swallow every
 * following statement and score sequential guard clauses as nesting.
 */
function statementBody(body: string, start: number, to: number): { bodyStart: number; bodyEnd: number } {
  let end = start;
  while (end < to && body[end] !== ';' && body[end] !== '\n') end++;
  if (end < to && body[end] === ';') end++;
  return { bodyStart: start, bodyEnd: end };
}

/**
 * Whether this word opens a nested control structure worth descending into.
 *
 * A member access and a key or label read as keywords but are not nesting.
 */
function isNestingHead(body: string, head: { word: string; end: number }, at: number): boolean {
  if (!NESTING_KEYWORDS.has(head.word)) return false;
  return !isMemberAccess(body, at) && !isKeyOrLabel(body, head.end);
}

/**
 * The `else` / `catch` / `finally` following a body, if any.
 *
 * The body end is inclusive of the closing brace, so the scan steps past it first.
 */
function trailingClause(body: string, after: number, to: number): { word: string; end: number } | null {
  let i = after;
  if (body[i] === '}') i++;
  i = skipSpaces(body, i, to);
  const tail = readWord(body, i);
  if (!tail) return null;
  return tail.word === 'else' || tail.word === 'catch' || tail.word === 'finally' ? tail : null;
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
  const rhs = indexOfAssignedValue(body, current, wordEnd);
  if (rhs < 0) return false;
  const start = skipAsyncModifier(body, rhs);
  if (body.startsWith('function', start)) return true;
  if (body[start] !== '(') return false;
  const close = skipBalancedParen(body, start);
  return body.startsWith('=>', skipArrowReturnType(body, close, body.length));
}

/**
 * Where the value assigned by `current` starts, or -1 when this is not an assignment.
 *
 * `current` is either a DECLARATION keyword, where the value follows a name
 * (`const name = ...`), or an identifier being assigned directly (`name = ...`).
 */
function indexOfAssignedValue(body: string, current: string, wordEnd: number): number {
  let k = wordEnd;
  if (isDeclarationKeyword(current)) {
    const name = readWord(body, skipSpaces(body, k, body.length));
    if (!name) return -1;
    k = name.end;
  } else if (!IDENTIFIER.test(current)) {
    return -1;
  }
  k = skipSpaces(body, k, body.length);
  if (body[k] !== '=') return -1;
  return skipSpaces(body, k + 1, body.length);
}

/** A JavaScript identifier: what a bare assignment target must be. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `const` / `let` / `var`: the value sits after a name. */
function isDeclarationKeyword(word: string): boolean {
  return word === 'const' || word === 'let' || word === 'var';
}

/**
 * Step past an `async` modifier, when there is one.
 *
 * `const name = async (...) => {` is an arrow too, and the modifier sits between the
 * `=` and the parameter list.
 */
function skipAsyncModifier(body: string, from: number): number {
  if (!body.startsWith('async', from)) return from;
  if (/[\w$]/.test(body[from + 5] ?? '')) return from;
  return skipSpaces(body, from + 5, body.length);
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
  // A return-type annotation sits between the parameter list and the body
  // (`function inner(): { a: number } { ... }`), and braces inside it are not
  // the body. When an annotation is present the body brace is located directly.
  if (body[skipSpaces(body, i, to)] === ':') {
    return findBraceAfterReturnType(body, i, to);
  }
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
  // An arrow's return type may be an object literal, so inner braces are part of
  // the type.
  return scanTypeTo(body, start + 1, to);
}

/**
 * Index of the `{` that opens a function/method body, given a position just
 * after the parameter list.
 *
 * The return-type annotation may nest braces arbitrarily --
 * `m(): Promise<{ ok: boolean }>`, `m(): { a: number } | null`, `m(): void`.
 * So every balanced `{...}` that is part of the type is skipped, and the first
 * brace that is followed by anything other than a continuation of the type is
 * taken as the body. Walking the type token by token is what tells the two
 * apart: a body brace is preceded by a complete type and is not inside `<>`.
 *
 * @returns the index of the body's `{`, or -1 when none is found before the
 *   statement ends.
 */
function findBraceAfterReturnType(body: string, from: number, to: number): number {
  let i = skipSpaces(body, from, to);
  if (body[i] !== ':') return i;
  i = skipSpaces(body, i + 1, to);

  let angles = 0;
  for (; i < to; i++) {
    const c = body[i];
    if (c === ';' || c === '\n') return -1;
    angles = adjustAngleDepth(c, angles);
    if (c !== '{') continue;

    const brace = classifyReturnBrace(body, i, angles, to);
    if (brace.kind === 'type') { i = brace.next - 1; continue; }
    return brace.kind === 'body-after' ? brace.next : i;
  }
  return -1;
}

/**
 * Track `<` / `>` depth, which tells type arguments from comparison operators.
 *
 * @param {string} c the character
 * @param {number} angles current depth
 * @returns {number} the new depth
 */
function adjustAngleDepth(c: string, angles: number): number {
  if (c === '<') return angles + 1;
  if (c === '>' && angles > 0) return angles - 1;
  return angles;
}

/**
 * What the `{` at `i` is, when scanning a return type.
 *
 * Inside `<>` a brace belongs to a type argument (`Promise<{ok:boolean}>`) and the
 * scan simply continues. At depth 0 it is either the function BODY -- what the caller
 * wants -- or an object TYPE, in which case the real body follows it
 * (`m(): {a:number} { ... }`), recognised by a `|`/`&`/`[` continuing the type or by
 * another `{` after it.
 *
 * @returns {{kind: 'type'|'body'|'body-after', next: number}} `next` is the index to
 *   resume from; for 'body-after' it is the real body's `{`
 */
function classifyReturnBrace(body: string, i: number, angles: number, to: number) {
  const afterBrace = skipBalancedBrace(body, i);
  if (angles > 0) return { kind: 'type', next: afterBrace };

  const rest = skipSpaces(body, afterBrace, to);
  if (rest >= to) return { kind: 'body', next: i };
  const continues = '|&'.includes(body[rest]) || body[rest] === '[';
  if (continues) return { kind: 'type', next: afterBrace };
  return body[rest] === '{' ? { kind: 'body-after', next: rest } : { kind: 'body', next: i };
}

/** One classified step of an arrow return-type scan. */
type TypeScanStep = 'stop' | 'open-brace' | 'close-brace' | 'open-angle' | 'close-angle' | 'skip';

/**
 * Characters that open a type-level brace or angle, and the step each reports.
 *
 * A lookup because the classification is per CHARACTER; the two cases that depend on
 * depth (`}` and flat-only terminators) are handled before this is consulted and must
 * not be moved into it.
 */
const TYPE_STEPS: Record<string, TypeScanStep> = {
  '{': 'open-brace',
  '<': 'open-angle',
};

/** Characters that end a type scan at depth 0: the arrow, or the statement end. */
const TYPE_TERMINATORS = new Set([';', '\n']);

/**
 * Classify one character of an arrow's return type.
 *
 * An arrow's return type may itself be an object literal (`(x): { ok: boolean } =>`),
 * so a `{` opens a TYPE brace rather than ending the scan -- which is why this cannot
 * simply stop at the first brace it sees.
 *
 * `}` needs the depth to be read before it can be classified: at depth 0 it closes the
 * ENCLOSING block, so the type cannot extend past it.
 *
 * @returns the step
 */
function classifyTypeChar(body: string, i: number, braces: number, angles: number): TypeScanStep {
  const c = body[i];
  if (c === '}') return braces === 0 ? 'stop' : 'close-brace';
  if (c === '=' && body[i + 1] === '>' && braces === 0 && angles === 0) return 'stop';
  if (braces === 0 && angles === 0 && TYPE_TERMINATORS.has(c)) return 'stop';
  return TYPE_STEPS[c] || 'skip';
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
 * Characters consumed when `advanceNestingState` reads a two-character pair:
 * an escaped backslash, a comment open, or a comment close.
 *
 * Named so the scan below cannot silently treat a future three-character
 * consumption as one -- only this value is special-cased.
 */
const PAIR_CONSUMED = 2;

/**
 * Advance the quoting/commenting state machine by one character.
 *
 * Pure with respect to depth: it only updates `state` and reports how many
 * characters were consumed, so the counting and the lexing can be reasoned about
 * separately (#602).
 *
 * @returns `PAIR_CONSUMED` when a two-character pair was consumed whole, else 1.
 */
/** A line comment ends at the newline, which is consumed with it. */
function advanceLineComment(c: string, state: NestingScanState): number {
  if (c === '\n') state.inLineComment = false;
  return 1;
}

/** A block comment ends at the slash-star closing pair, so that pair consumes two. */
function advanceBlockComment(c: string, next: string, state: NestingScanState): number {
  if (c === '*' && next === '/') {
    state.inBlockComment = false;
    return 2;
  }
  return 1;
}

/**
 * Inside a string: a backslash escapes the next character, the closing quote ends it.
 *
 * @param close called when the quote closes the context
 */
function advanceString(c: string, next: string, quote: string, close: () => void): number {
  if (c === '\\') return 2;
  if (c === quote) close();
  return 1;
}

/**
 * The string-like contexts, and how each closes.
 *
 * A table rather than a chain of `if (state.inX)`: the three contexts share one shape
 * (escape consumes two, the closing quote ends it, everything else consumes one) and
 * differ only in the quote character.
 */
const STRING_CONTEXTS: Array<{ flag: 'inSingle' | 'inDouble' | 'inTemplate'; quote: string }> = [
  { flag: 'inSingle', quote: "'" },
  { flag: 'inDouble', quote: '"' },
  { flag: 'inTemplate', quote: '`' },
];

/**
 * Recognise an opening comment or string delimiter, when no context is active.
 *
 * The order in `advanceNestingState` matters and is the whole algorithm: an opening
 * delimiter is only seen when nothing else is active, so a slash-slash inside a
 * string stays data and a quote inside a comment stays a comment.
 *
 * @returns characters consumed: 2 for a comment opener, 1 otherwise
 */
function openContext(c: string, next: string, state: NestingScanState): number {
  if (c === '/' && next === '/') {
    state.inLineComment = true;
    return 2;
  }
  if (c === '/' && next === '*') {
    state.inBlockComment = true;
    return 2;
  }
  const opened = STRING_CONTEXTS.find((ctx) => ctx.quote === c);
  if (opened) state[opened.flag] = true;
  return 1;
}

/** The active string context for this state, if any. */
function activeStringContext(state: NestingScanState) {
  return STRING_CONTEXTS.find((ctx) => state[ctx.flag]);
}

/**
 * Advance one lexical token, returning how many characters it consumed.
 */
function advanceNestingState(body: string, i: number, state: NestingScanState): number {
  const c = body[i];
  const next = body[i + 1];

  if (state.inLineComment) return advanceLineComment(c, state);
  if (state.inBlockComment) return advanceBlockComment(c, next, state);

  const context = activeStringContext(state);
  if (context) {
    return advanceString(c, next, context.quote, () => { state[context.flag] = false; });
  }
  return openContext(c, next, state);
}

/** True when the current state's character carries structure, not data. */
function isStructuralAt(state: NestingScanState): boolean {
  return !state.inSingle && !state.inDouble && !state.inTemplate
    && !state.inLineComment && !state.inBlockComment;
}
