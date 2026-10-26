import { BaseAdapter } from './base';
import { Adapter } from '../types';

/** IO-ish callees that the missing-error-handling rule cares about. */
const IO_CALLEES = [
  'readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
  'open', 'openSync', 'unlink', 'unlinkSync', 'mkdir', 'mkdirSync', 'readdir', 'readdirSync',
  'stat', 'statSync', 'access', 'accessSync', 'fetch', 'axios', 'createReadStream', 'createWriteStream',
];

/**
 * Child-process / network entry points. `exec` and friends are matched only as
 * bare calls (no `obj.` receiver): `regex.exec(str)` is not IO, so requiring the
 * call to start a statement avoids flagging `RegExp.prototype.exec` (#446).
 */
const IO_GLOBAL_CALLEES = ['exec', 'execSync', 'spawn', 'spawnSync', 'request'];

/**
 * Builders, not shared literals: a module-level regex with the `g` flag carries
 * mutable `lastIndex` across calls, so any caller that forgets to reset it
 * silently drops matches. Fresh instances keep every call independent.
 */
function ioCalleeRe(): RegExp {
  return new RegExp(`\\b(?:${IO_CALLEES.join('|')})\\s*\\(`, 'g');
}

function ioGlobalRe(): RegExp {
  return new RegExp(`(?:^|[^.\\w$])(?:${IO_GLOBAL_CALLEES.join('|')})\\s*\\(`, 'gm');
}

/** Keywords that look like `name(` but are control flow, not callables. */
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete',
  'void', 'in', 'instanceof', 'do', 'else', 'try', 'finally', 'throw', 'await',
  'yield', 'function', 'class', 'super', 'this', 'import', 'export', 'default',
  'case', 'break', 'continue', 'const', 'let', 'var', 'as', 'satisfies', 'keyof',
]);

// ---------------------------------------------------------------------------
// Lizard parse note: these two helpers are laid out so that no declaration
// carrying a return type annotation is immediately followed by a JSDoc block.
// lizard 1.21.3 mis-scopes that combination and reports the pairing as one row
// spanning every following function (measured here: findBodyBrace swallowed the
// rest of the file at CCN 69). Keep the plain comment style above them.
// ---------------------------------------------------------------------------

// Advance one scan character against the type-literal depth. Returns the new
// depth plus the index to resume from, so parenthesised groups are skipped whole.
// The inline typed-return form is avoided deliberately: lizard 1.21.3 loses the
// function boundary when a return annotation contains a brace literal.
type ScanStep = { depth: number; resume: number };

const stepDepth = (masked: string, c: string, i: number, depth: number): ScanStep => {
  if (c === '(') {
    const { end } = readParenGroup(masked, i);
    return { depth, resume: end - 1 };
  }
  if (c === '<' || c === '[') return { depth: depth + 1, resume: i };
  if (c === '>' || c === ']') return { depth: Math.max(0, depth - 1), resume: i };
  if (c === '}') return { depth: Math.max(0, depth - 1), resume: i };
  return { depth, resume: i };
};

function findBodyBrace(masked: string, parenIndex: number): number {
  if (masked[parenIndex] !== '(') return -1;
  const { end } = readParenGroup(masked, parenIndex);
  let depth = 0;
  let i = end;
  while (i < masked.length) {
    const c = masked[i];
    if (c === '{') {
      if (depth === 0) return i;
      depth++;
      i++;
      continue;
    }
    // A line break or semicolon before any brace means this header has no
    // braced body (an interface member or an overload signature).
    if ((c === ';' || c === '\n') && depth === 0) return -1;
    const stepped = stepDepth(masked, c, i, depth);
    depth = stepped.depth;
    i = stepped.resume + 1;
  }
  return -1;
}

// Index just past the matching closing brace for the block opened at open.
// Written with explicit braces throughout: an unbraced else-if chain here made
// lizard 1.21.3 extend the PREVIOUS function's span over this whole region.
function findBlockEnd(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') {
      depth++;
      continue;
    }
    if (c !== '}') continue;
    depth--;
    if (depth === 0) return i + 1;
  }
  return masked.length;
}

/** Keywords that begin a new top-level declaration. */
const DECLARATION_KEYWORDS = /^(?:export|import|interface|class|const|let|var|function|type|declare|@)/;

/**
 * True when a newline at `index` ends a declaration that has no body: the next
 * line starts another declaration (or a decorator). Without this the scan runs
 * into the following declaration and reports ITS brace as this one's body.
 */
function startsNewDeclaration(masked: string, index: number): boolean {
  const rest = masked.substring(index + 1).replace(/^[ \t]*/, '');
  return DECLARATION_KEYWORDS.test(rest);
}

/** What the declaration scan should do with the character it just read. */
type ScanAction =
  | { kind: 'advance' }
  | { kind: 'jump'; to: number }
  | { kind: 'depth'; delta: 1 | -1 }
  | { kind: 'body'; at: number }
  | { kind: 'no-body' };

/** Characters that open a generic/bracket group in a declaration header. */
const HEADER_OPENERS = new Set(['<', '[']);
/** Characters that close one. */
const HEADER_CLOSERS = new Set(['>', ']']);

/**
 * Decide what the declaration scan does at `i`.
 *
 * Table-driven rather than an `if` ladder (#620): the interesting cases are
 * "this character means something", and a per-character decision keeps that list
 * readable and each rule independently testable.
 */
function declarationScanAction(masked: string, i: number, depth: number): ScanAction {
  const c = masked[i];

  // A parenthesised group is skipped whole: parens only ever appear inside a
  // header (`class X extends Y<() => void>`), never as body structure.
  if (c === '(') return { kind: 'jump', to: readParenGroup(masked, i).end - 1 };
  if (HEADER_OPENERS.has(c)) return { kind: 'depth', delta: 1 };
  if (HEADER_CLOSERS.has(c)) return { kind: 'depth', delta: -1 };

  if (c === '{') return depth === 0 ? { kind: 'body', at: i } : { kind: 'depth', delta: 1 };
  if (c === '}') return { kind: 'depth', delta: -1 };

  if (c === ';' && depth === 0) return { kind: 'no-body' };
  if (c === '\n' && depth === 0 && startsNewDeclaration(masked, i)) return { kind: 'no-body' };
  return { kind: 'advance' };
}

/**
 * Body brace for declarations that have no parameter list (`class`, `interface`).
 * Scans forward from the end of the declaration header; the first `{` at generic
 * depth 0 is the body. A `;` before any brace means there is no body.
 */
function findDeclarationBrace(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const action = declarationScanAction(masked, i, depth);
    switch (action.kind) {
      case 'body': return action.at;
      case 'no-body': return -1;
      case 'jump': i = action.to; break;
      case 'depth':
        // Depth never goes negative: a stray closing bracket in a header must
        // not look like the start of a new group.
        depth = Math.max(0, depth + action.delta);
        break;
      case 'advance': break;
    }
  }
  return -1;
}

function lineOf(src: string, index: number): number {
  return src.substring(0, index).split('\n').length;
}

/** The three quoted states shared by the parameter/paren scanners. */
interface QuoteState {
  inSingle: boolean;
  inDouble: boolean;
  inTemplate: boolean;
}

function newQuoteState(): QuoteState {
  return { inSingle: false, inDouble: false, inTemplate: false };
}

function inQuotedState(state: QuoteState): boolean {
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
function advanceQuoteState(src: string, i: number, state: QuoteState): number {
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
function applyDelimiter(c: string, depth: { value: number }): boolean {
  if (DEPTH_OPENERS.has(c)) { depth.value++; return true; }
  if (DEPTH_CLOSERS.has(c)) { depth.value--; return true; }
  return false;
}

/** True when the character opens a quote/template the scanners must skip. */
function isQuote(c: string): boolean {
  return c === "'" || c === '"' || c === '`';
}

/** Count top-level, comma-separated parameters in a raw parameter list. */
function countParams(rawList: string): number {
  const trimmed = rawList.trim();
  if (trimmed === '') return 0;

  const depth = { value: 0 };
  let count = 1;
  const state = newQuoteState();

  for (let i = 0; i < trimmed.length;) {
    if (inQuotedState(state)) {
      i += advanceQuoteState(trimmed, i, state);
      continue;
    }
    const c = trimmed[i];
    if (isQuote(c)) {
      advanceQuoteState(trimmed, i, state);
    } else if (!applyDelimiter(c, depth) && c === ',' && depth.value === 0) {
      count++;
    }
    i++;
  }
  return count;
}

/**
 * Extract the balanced `( ... )` group that starts at `open`.
 * Returns the inner text and the index just past the closing paren.
 */
function readParenGroup(src: string, open: number): { inner: string; end: number } {
  let depth = 0;
  const state = newQuoteState();

  for (let i = open; i < src.length;) {
    if (inQuotedState(state)) {
      i += advanceQuoteState(src, i, state);
      continue;
    }
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      advanceQuoteState(src, i, state);
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return { inner: src.substring(open + 1, i), end: i + 1 };
    }
    i++;
  }
  return { inner: src.substring(open + 1), end: src.length };
}

/**
 * The lexical states `maxNesting` tracks while counting braces. Braces inside
 * any of these are data, not structure, so they must not change the count.
 */
interface NestingScanState {
  inSingle: boolean;
  inDouble: boolean;
  inTemplate: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

/**
 * One handler per lexical state. Each returns how many characters were
 * consumed, and mutates `state` only when the construct actually ends.
 *
 * Split out of a single 22-CCN dispatcher (#602): every state's exit condition
 * is independent, so keeping them in one body bought nothing but branch count.
 */
type StateAdvance = (body: string, i: number, state: NestingScanState) => number;

const advanceLineComment: StateAdvance = (body, i, state) => {
  if (body[i] === '\n') state.inLineComment = false;
  return 1;
};

const advanceBlockComment: StateAdvance = (body, i, state) => {
  if (body[i] === '*' && body[i + 1] === '/') {
    state.inBlockComment = false;
    return 2;
  }
  return 1;
};

/** Shared shape of the three quoted states: honour `\`, close on the delimiter. */
const advanceSingleQuote: StateAdvance = (body, i, state) => {
  if (body[i] === '\\') return 2;
  if (body[i] === "'") state.inSingle = false;
  return 1;
};

const advanceDoubleQuote: StateAdvance = (body, i, state) => {
  if (body[i] === '\\') return 2;
  if (body[i] === '"') state.inDouble = false;
  return 1;
};

const advanceTemplate: StateAdvance = (body, i, state) => {
  if (body[i] === '\\') return 2;
  if (body[i] === '`') state.inTemplate = false;
  return 1;
};

/**
 * Enter a construct when the current character opens one.
 * @returns characters consumed, or 0 when nothing was opened.
 */
function openConstruct(body: string, i: number, state: NestingScanState): number {
  const c = body[i];
  const next = body[i + 1];
  if (c === '/' && next === '/') { state.inLineComment = true; return 2; }
  if (c === '/' && next === '*') { state.inBlockComment = true; return 2; }
  if (c === "'") { state.inSingle = true; return 1; }
  if (c === '"') { state.inDouble = true; return 1; }
  if (c === '`') { state.inTemplate = true; return 1; }
  return 0;
}

/**
 * Advance the quoting/commenting state machine by one character.
 *
 * Pure with respect to depth: it only updates `state` and reports how many
 * characters were consumed. Extracted from `maxNesting` (#602) so the brace
 * counting and the lexing can be reasoned about separately -- the combined body
 * carried every branch of both.
 *
 * @returns the number of characters consumed (1, or 2 for the escape/close
 *          pairs that swallow the next character).
 */
function advanceNestingState(
  body: string,
  i: number,
  state: NestingScanState,
): number {
  if (state.inLineComment) return advanceLineComment(body, i, state);
  if (state.inBlockComment) return advanceBlockComment(body, i, state);
  if (state.inSingle) return advanceSingleQuote(body, i, state);
  if (state.inDouble) return advanceDoubleQuote(body, i, state);
  if (state.inTemplate) return advanceTemplate(body, i, state);
  const opened = openConstruct(body, i, state);
  return opened === 0 ? 1 : opened;
}

/** True when the character at `i` is structural (not inside a literal/comment). */
function isStructuralAt(state: NestingScanState): boolean {
  return !state.inSingle && !state.inDouble && !state.inTemplate &&
    !state.inLineComment && !state.inBlockComment;
}

/** Max brace nesting depth inside a function body (1 = body itself). */
function maxNesting(body: string): number {
  let depth = 0;
  let max = 0;
  const state: NestingScanState = {
    inSingle: false,
    inDouble: false,
    inTemplate: false,
    inLineComment: false,
    inBlockComment: false,
  };

  for (let i = 0; i < body.length;) {
    const consumed = advanceNestingState(body, i, state);
    if (consumed === 2) {
      // The pair (escape, comment close, comment open) is consumed whole. A
      // comment opener must not also be read as a brace-less character below.
      i += 2;
      continue;
    }
    if (isStructuralAt(state)) {
      const c = body[i];
      if (c === '{') { depth++; if (depth > max) max = depth; }
      else if (c === '}') depth--;
    }
    i += 1;
  }
  return max;
}

/** Which IO callees appear in this body. */
function ioOperationsIn(body: string): string[] {
  const found = new Set<string>();
  // Fresh regex instances per call: no shared lastIndex to reset or leak.
  for (const m of body.matchAll(ioCalleeRe())) {
    found.add(m[0].replace(/\s*\($/, ''));
  }
  for (const m of body.matchAll(ioGlobalRe())) {
    const name = /(\w+)\s*\($/.exec(m[0].trim());
    if (name) found.add(name[1]);
  }
  return [...found];
}

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
  while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
    if (src[i] !== '\n') out[i] = ' ';
    i++;
  }
  if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
  return i;
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
function findRegexClose(src: string, start: number): number {
  let inClass = false;
  for (let j = start + 1; j < src.length; j++) {
    const d = src[j];
    if (d === '\\') { j++; continue; }
    if (d === '\n') return -1;
    if (d === '[') { inClass = true; continue; }
    if (d === ']') { inClass = false; continue; }
    if (d === '/' && !inClass) return j;
  }
  return -1;
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
    const d = src[i];
    if (d === '\\') {
      out[i] = ' ';
      if (i + 1 < src.length) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (d === quote) { out[i] = ' '; i++; break; }
    if (d === '\n' && quote !== '`') break;
    out[i] = ' ';
    i++;
  }
  return i;
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
function maskLiterals(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      i = maskLineComment(src, out, i);
      continue;
    }
    if (c === '/' && next === '*') {
      i = maskBlockComment(src, out, i);
      continue;
    }
    if (c === '/' && opensRegexLiteral(src, i)) {
      const resumed = maskRegexLiteral(src, out, i);
      // -1/findRegexClose failure keeps start, so `i` only advances on a match.
      if (resumed !== i) { i = resumed; continue; }
    }
    if (c === "'" || c === '"' || c === '`') {
      i = maskStringLiteral(src, out, i);
      continue;
    }

    i++;
  }
  return out.join('');
}

/**
 * The metrics the rule set actually reads (see src/principles/rules/**).
 * Previously only {name,type,line,code} was returned, so every rule that reads
 * `length` / `paramCount` / `nestingDepth` / `hasTryCatch` / `methodCount`
 * silently never fired on TypeScript (#446).
 */
interface FunctionMetrics {
  name: string;
  type: 'function' | 'method' | 'arrow';
  line: number;
  startLine: number;
  endLine: number;
  /** Body line span, matching the `length` field long-function reads. */
  length: number;
  paramCount: number;
  nestingDepth: number;
  hasTryCatch: boolean;
  ioOperations: string[];
  code: string;
}

export class TypeScriptAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.ts') || ext.endsWith('.tsx')) {
      return 'typescript';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return this.createParseResult('typescript');
  }

  private maskedCache?: string;

  /**
   * The file with comments and string/template/regex literals blanked out,
   * computed ONCE per adapter instance. Every extraction pass used to call
   * maskLiterals(this.fileContent) itself, and buildFunction() called it again
   * for each function -- O(functions x fileLength) per file.
   */
  private get maskedSource(): string {
    if (this.maskedCache === undefined) {
      this.maskedCache = maskLiterals(this.fileContent);
    }
    return this.maskedCache;
  }


  /**
   * Numeric literals for the magic-numbers rule, which reads
   * `adapter.extract()` -> `[{value, line}]`. Numbers inside comments and
   * string/template literals are skipped via maskLiterals().
   *
   * A number that IS the initializer of a named constant is skipped: the rule's
   * own advice is "consider using a named constant instead", so reporting the
   * constant it just asked for made the violation unfixable -- extracting the
   * literal could never clear it.
   */
  extract(): Array<{ value: number; line: number }> {
    const src = this.fileContent;
    const results: Array<{ value: number; line: number }> = [];
    const masked = this.maskedSource;

    // `const NAME = 3` / `const NAME: T = 3` -- capture the value's offset so the
    // literal can be matched positionally rather than by value.
    const namedConstRe = /\b(?:const|readonly)\s+[A-Za-z_$][\w$]*\s*(?::[^=;]+)?=\s*(-?\d+(?:\.\d+)?)\s*;/g;
    const namedConstOffsets = new Set<number>();
    let c: RegExpExecArray | null;
    while ((c = namedConstRe.exec(masked)) !== null) {
      namedConstOffsets.add(c.index + c[0].lastIndexOf(c[1]));
    }

    const numRe = /(?<![\w$.])(-?\d+(?:\.\d+)?)(?![\w$])/g;
    let m: RegExpExecArray | null;
    while ((m = numRe.exec(masked)) !== null) {
      if (namedConstOffsets.has(m.index)) continue;
      results.push({ value: Number(m[1]), line: lineOf(src, m.index) });
    }
    return results;
  }

  /**
   * Import specifiers for the unused-imports rule. The rule reads
   * `adapter.imports` as `Array<{name, line, used, type?}>` -- returning bare
   * strings made every entry look unused and rendered `undefined` as the name.
   * `used` is computed by counting identifier occurrences outside the import
   * statements themselves.
   */
  get imports(): Array<{ name: string; line: number; used: boolean; type?: string }> {
    const src = this.fileContent;
    const entries: Array<{ name: string; line: number; used: boolean; type?: string }> = [];
    const importRe = /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm;
    const importSpans: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    const idRe = /^[A-Za-z_$][\w$]*$/;

    while ((m = importRe.exec(src)) !== null) {
      const clause = m[1].trim();
      const line = lineOf(src, m.index);
      const isTypeOnly = /^import\s+type\b/.test(m[0]);
      const push = (name: string, type?: string) => {
        if (idRe.test(name)) entries.push({ name, line, used: false, ...(type ? { type } : {}) });
      };

      // default import
      const def = /^(\w+)/.exec(clause);
      if (def) push(def[1], isTypeOnly ? 'type' : undefined);

      // named imports { a, b as c }
      const braces = /\{([\s\S]*?)\}/.exec(clause);
      if (braces) {
        for (const raw of braces[1].split(',')) {
          const part = raw.trim();
          if (!part) continue;
          const asMatch = /\bas\s+(\w+)\s*$/.exec(part);
          const local = asMatch ? asMatch[1] : part.replace(/^type\s+/, '').trim();
          const memberTypeOnly = /^type\s+/.test(part);
          push(local, isTypeOnly || memberTypeOnly ? 'type' : undefined);
        }
      }

      // namespace import * as ns
      const ns = /\*\s+as\s+(\w+)/.exec(clause);
      if (ns) push(ns[1], isTypeOnly ? 'type' : undefined);

      importSpans.push([m.index, m.index + m[0].length]);
    }

    // Count identifier usage outside import statements.
    let body = src;
    for (const [start, end] of [...importSpans].reverse()) {
      body = body.substring(0, start) + ' '.repeat(end - start) + body.substring(end);
    }
    for (const entry of entries) {
      const useRe = new RegExp(`(?<![\\w$.])${entry.name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
      entry.used = useRe.test(body);
    }

    return entries;
  }

  /**
   * Interfaces for the ISP rule, which reads `adapter.extractInterfaces()`.
   */
  extractInterfaces(): Array<{ name: string; line: number; methods: string[]; methodCount: number; code: string }> {
    const src = this.fileContent;
    const masked = this.maskedSource;
    const results: Array<{ name: string; line: number; methods: string[]; methodCount: number; code: string }> = [];
    const ifaceRe = /(?:export\s+)?(?:declare\s+)?interface\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = ifaceRe.exec(masked)) !== null) {
      const bodyOpen = findDeclarationBrace(masked, ifaceRe.lastIndex);
      if (bodyOpen === -1) continue;
      const bodyEnd = findBlockEnd(masked, bodyOpen);
      const body = src.substring(bodyOpen, bodyEnd);
      const methods = [...body.matchAll(/(?<![\w$.])(\w+)\s*\(/g)]
        .map(x => x[1])
        .filter(n => !CONTROL_KEYWORDS.has(n));
      results.push({
        name: m[1],
        line: lineOf(src, m.index),
        methods,
        methodCount: methods.length,
        code: body,
      });
    }
    return results;
  }

  private buildFunction(
    name: string,
    type: 'function' | 'method' | 'arrow',
    nameIndex: number,
    parenIndex: number,
    bodyOpen: number,
  ): FunctionMetrics {
    const src = this.fileContent;
    // Bodies/positions come from the real source; brace matching uses the masked
    // text so braces inside regex/string literals cannot desync the block scan.
    const masked = this.maskedSource;
    const { inner } = readParenGroup(masked, parenIndex);
    const bodyEnd = findBlockEnd(masked, bodyOpen);
    const body = src.substring(bodyOpen, bodyEnd);
    const startLine = lineOf(src, nameIndex);
    const endLine = lineOf(src, bodyEnd);

    // Arrow functions may be `=> expr` with no braces; then the "body" is a
    // single expression and `findBlockEnd` will not have found a `{`.
    const hasBraces = masked[bodyOpen] === '{';

    return {
      name,
      type,
      line: startLine,
      startLine,
      endLine,
      length: hasBraces ? Math.max(1, endLine - startLine + 1) : 1,
      paramCount: countParams(inner),
      nestingDepth: hasBraces ? maxNesting(maskLiterals(body)) : 0,
      hasTryCatch: /\btry\s*\{/.test(masked.substring(bodyOpen, bodyEnd)),
      ioOperations: ioOperationsIn(masked.substring(bodyOpen, bodyEnd)),
      code: body,
    };
  }

  extractFunctions(): unknown[] {
    // Match declarations against the masked source so identifiers that appear
    // only in comments or strings are never mistaken for functions, while
    // bodies/positions still come from the original text (same offsets).
    const seen = new Set<string>();
    const found: FunctionMetrics[] = [];
    // Three independent syntactic shapes, one collector each. Splitting them out
    // of the single CCN-20 body also keeps each shape's quirks (see the comments
    // on the collectors) next to the code they explain.
    this.collectFunctionDecls(seen, found);
    this.collectClassMethods(seen, found);
    this.collectArrowFunctions(seen, found);
    return found;
  }

  /** Claim a `name@offset` key once, so overlapping shapes cannot double-count. */
  private claim(seen: Set<string>, name: string, nameIndex: number): boolean {
    const key = `${name}@${nameIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }

  /** `function name(...)` declarations, including export / async / generators. */
  private collectFunctionDecls(seen: Set<string>, found: FunctionMetrics[]): void {
    const masked = this.maskedSource;
    const declRe = /(?:^|[^\w$.])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*/g;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(masked)) !== null) {
      const nameIndex = m.index + m[0].length - m[1].length;
      const parenIndex = masked.indexOf('(', declRe.lastIndex - 1);
      if (parenIndex === -1) continue;
      const bodyOpen = findBodyBrace(masked, parenIndex);
      if (bodyOpen === -1) continue;
      if (!this.claim(seen, m[1], nameIndex)) continue;
      found.push(this.buildFunction(m[1], 'function', nameIndex, parenIndex, bodyOpen));
    }
  }

  /**
   * Class methods: `name(...) {`. Not anchored to line start so minified
   * single-line bodies count too. Control-flow keywords are excluded -- a bare
   * `if (a > 0) {` matches the shape but is not a method.
   */
  private collectClassMethods(seen: Set<string>, found: FunctionMetrics[]): void {
    const masked = this.maskedSource;
    const memberRe = /(?<![\w$.])(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+|\*\s*)*(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = memberRe.exec(masked)) !== null) {
      if (CONTROL_KEYWORDS.has(m[1])) continue;
      // The pattern ends with `\(`, so the match's last character IS the opening
      // paren. Re-searching with indexOf() could drift to a later `(` inside the
      // parameter list or a type annotation, which corrupted the reported span.
      const parenIndex = m.index + m[0].length - 1;
      const nameIndex = parenIndex - m[1].length;
      // Only treat as a method when a body brace follows the parameter list.
      const bodyOpen = findBodyBrace(masked, parenIndex);
      if (bodyOpen === -1) continue;
      if (!this.claim(seen, m[1], nameIndex)) continue;
      found.push(this.buildFunction(m[1], 'method', nameIndex, parenIndex, bodyOpen));
    }
  }

  /** Arrow consts / assignments: `const name = (...) =>` / `name = x =>`. */
  private collectArrowFunctions(seen: Set<string>, found: FunctionMetrics[]): void {
    const masked = this.maskedSource;
    const arrowRe = /(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?/g;
    let m: RegExpExecArray | null;
    while ((m = arrowRe.exec(masked)) !== null) {
      const arrow = this.parseArrowAt(m, arrowRe.lastIndex);
      if (!arrow) continue;
      const nameIndex = m.index + m[0].length - m[1].length;
      if (!this.claim(seen, m[1], nameIndex)) continue;
      found.push(this.buildArrowMetrics(m[1], nameIndex, arrow));
    }
  }

  /**
   * Resolve an arrow assignment's parameter list and body brace.
   * @returns null when the text after the assignment is not an arrow function.
   */
  private parseArrowAt(
    m: RegExpExecArray,
    scanFrom: number,
  ): { parenIndex: number; afterParams: number; bodyOpen: number } | null {
    const masked = this.maskedSource;
    const rest = masked.substring(scanFrom);
    const parenOffset = /^\s*\(/.test(rest) ? rest.indexOf('(') : -1;
    let parenIndex: number;
    if (parenOffset !== -1) {
      parenIndex = scanFrom + parenOffset;
    } else {
      // Single-identifier param: `x => ...`
      if (!/^\s*(\w+)\s*=>/.test(rest)) return null;
      parenIndex = -1;
    }
    const afterParams = parenIndex === -1
      ? scanFrom + (/^\s*(\w+)/.exec(rest) as RegExpExecArray)[0].length
      : readParenGroup(this.fileContent, parenIndex).end;
    if (!/^\s*(?::[^=]+)?=>/.test(masked.substring(afterParams))) return null;

    const braceAfter = masked.indexOf('{', afterParams);
    const isBlockBody = braceAfter !== -1 &&
      /^\s*(?::[^=]+)?=>\s*\{/.test(masked.substring(afterParams, braceAfter + 1));
    return { parenIndex, afterParams, bodyOpen: isBlockBody ? braceAfter : -1 };
  }

  /** Derive the metrics for one arrow function, whether or not it has a block body. */
  private buildArrowMetrics(
    name: string,
    nameIndex: number,
    arrow: { parenIndex: number; afterParams: number; bodyOpen: number },
  ): FunctionMetrics {
    const src = this.fileContent;
    const startLine = lineOf(src, nameIndex);

    // A concise body (`() => x + 1`) has no block, so it carries no measurable
    // span: length 1, no nesting, no io. Only a block body is inspected.
    if (arrow.bodyOpen === -1) {
      return {
        name,
        type: 'arrow',
        line: startLine,
        startLine,
        endLine: startLine,
        length: 1,
        paramCount: arrow.parenIndex === -1 ? 1 : countParams(readParenGroup(src, arrow.parenIndex).inner),
        nestingDepth: 0,
        hasTryCatch: false,
        ioOperations: [],
        code: '',
      };
    }

    const bodyEnd = findBlockEnd(this.maskedSource, arrow.bodyOpen);
    const code = src.substring(arrow.bodyOpen, bodyEnd);
    const endLine = lineOf(src, bodyEnd);
    return {
      name,
      type: 'arrow',
      line: startLine,
      startLine,
      endLine: startLine,
      length: Math.max(1, endLine - startLine + 1),
      paramCount: arrow.parenIndex === -1 ? 1 : countParams(readParenGroup(src, arrow.parenIndex).inner),
      nestingDepth: maxNesting(code),
      hasTryCatch: /\btry\s*\{/.test(code),
      ioOperations: ioOperationsIn(code),
      code,
    };
  }

  extractClasses(): unknown[] {
    const src = this.fileContent;
    const classRe = /(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    const results: Array<Record<string, unknown>> = [];
    const masked = this.maskedSource;
    let m: RegExpExecArray | null;

    while ((m = classRe.exec(masked)) !== null) {
      const name = m[2];
      const nameIndex = m.index + m[0].length - name.length;
      const bodyOpen = findDeclarationBrace(masked, classRe.lastIndex);
      if (bodyOpen === -1) continue;
      const bodyEnd = findBlockEnd(masked, bodyOpen);
      const body = src.substring(bodyOpen, bodyEnd);

      // Count method-ish members. Not anchored to line start: minified /
      // single-line class bodies (`m1() {} m2() {}`) are valid TS and must count.
      // `(?<![\w$.])` avoids matching call sites like `foo.bar(`.
      const memberRe = /(?<![\w$.])(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+|\*\s*)*(\w+)\s*\(/g;
      const methods = [...body.matchAll(memberRe)]
        .map(x => x[1])
        .filter(n => !['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new'].includes(n));

      results.push({
        name,
        type: 'class',
        line: lineOf(src, nameIndex),
        startLine: lineOf(src, nameIndex),
        endLine: lineOf(src, bodyEnd),
        methodCount: methods.length,
        methods,
        code: body,
      });
    }

    return results;
  }

  extractExports(): unknown[] {
    const exportMatches = [];
    const exportRegex = /^(export\s+(default\s+)?(async\s+)?(function|const|class|let|var|type|interface|enum)\s+\w+)/gm;
    let match;

    while ((match = exportRegex.exec(this.fileContent)) !== null) {
      exportMatches.push({
        name: match[0],
        type: 'export',
        line: this.getLineNumber(match.index)
      });
    }

    // A re-export block lists names this module FORWARDS, not names it
    // defines. Counting every forwarded member punishes exactly the barrel
    // split (many-exports → sub-module + `export { … } from`) that the rule
    // recommends, so only local `export { A, B };` blocks count — and each
    // counts once per exported name, as before for single-line blocks.
    const reExportRegex = /^export\s*\{([^}]*)\}(\s+from\s+[^;{]+)?;/gm;
    let reMatch;
    while ((reMatch = reExportRegex.exec(this.fileContent)) !== null) {
      if (reMatch[2]) continue; // `export { … } from '…'` forwards: no new surface
      const names = reMatch[1]
        .split(',')
        .map((part) => part.replace(/^type\s+/, '').trim())
        .filter((part) => part.length > 0);
      for (const name of names) {
        exportMatches.push({
          name,
          type: 're-export',
          line: this.getLineNumber(reMatch.index),
        });
      }
    }

    return exportMatches;
  }
}
