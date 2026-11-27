import { BaseAdapter } from './base';
import { maskLiterals } from './typescript-mask';
import { Adapter } from '../types';
import { isCallPosition } from './position-analysis';
import { claimMember, countTopLevelMembers } from './member-scan';
import { parseImportClause } from './import-clause';
import {
  type QuoteState, newQuoteState, inQuotedState, advanceQuoteState, applyDelimiter, isQuote,
} from './quote-state';
import { maxControlNesting } from './control-nesting';

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

/** Characters that open a generic/array context. */
const DEPTH_OPENERS = new Set(['<', '[']);
/** Characters that close one. `}` closes the enclosing block, not a generic. */
const DEPTH_CLOSERS = new Set(['>', ']', '}']);

/**
 * Advance one character, reporting the new depth and where to resume.
 *
 * A parenthesised group is skipped WHOLE: parens only appear inside a header
 * (`class X extends Y<() => void>`), never as body structure, so scanning inside one
 * would count its contents as depth.
 *
 * `Math.max(0, …)` on closers: a `>` in a comparison is not a generic close, and a
 * negative depth would make every later check wrong.
 */
const stepDepth = (masked: string, c: string, i: number, depth: number): ScanStep => {
  if (c === '(') {
    const { end } = readParenGroup(masked, i);
    return { depth, resume: end - 1 };
  }
  if (DEPTH_OPENERS.has(c)) return { depth: depth + 1, resume: i };
  if (DEPTH_CLOSERS.has(c)) return { depth: Math.max(0, depth - 1), resume: i };
  return { depth, resume: i };
};

/** Whether the character ends a header without a braced body. */
function isHeaderTerminator(c: string, depth: number): boolean {
  return (c === ';' || c === '\n') && depth === 0;
}

function findBodyBrace(masked: string, parenIndex: number): number {
  if (masked[parenIndex] !== '(') return -1;
  const { end } = readParenGroup(masked, parenIndex);
  let depth = 0;
  let i = end;
  while (i < masked.length) {
    const c = masked[i];
    if (isBodyBraceAt(c, depth)) return i;
    if (isHeaderTerminator(c, depth)) return -1;
    const stepped = stepDepth(masked, c, i, depth);
    depth = stepped.depth;
    i = stepped.resume + 1;
  }
  return -1;
}

/**
 * Whether this character IS the function's body brace.
 *
 * A brace at depth 0 is the body; deeper it is a generic argument (`<{a: number}>`), and
 * stopping there would measure a type as the function.
 */
function isBodyBraceAt(c: string, depth: number): boolean {
  return c === '{' && depth === 0;
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
/**
 * How each header bracket changes DEPTH.
 *
 * Angle brackets nest in generic arguments, so a brace inside them is a TYPE
 * (`class X extends Y<{a: number}>`) and not the body. A table because every arm is the
 * same one-field answer.
 */
const HEADER_DEPTH_DELTA: Record<string, 1 | -1> = {};
for (const c of HEADER_OPENERS) HEADER_DEPTH_DELTA[c] = 1;
for (const c of HEADER_CLOSERS) HEADER_DEPTH_DELTA[c] = -1;

function declarationScanAction(masked: string, i: number, depth: number): ScanAction {
  const c = masked[i];

  if (c === '(') return skipParenGroup(masked, i);
  const delta = HEADER_DEPTH_DELTA[c];
  if (delta !== undefined) return { kind: 'depth', delta };
  if (isBraceChar(c)) return braceAction(c, i, depth);
  if (isDeclarationTerminator(masked, i, c, depth)) return { kind: 'no-body' };
  return { kind: 'advance' };
}

/** Whether this character is a brace. */
function isBraceChar(c: string): boolean {
  return c === '{' || c === '}';
}

/**
 * Jump over a parenthesised group.
 *
 * Skipped whole because parens only ever appear inside a header
 * (`class X extends Y<() => void>`), never as body structure -- so stepping into one
 * could only misread its contents as braces.
 */
function skipParenGroup(masked: string, i: number): ScanAction {
  return { kind: 'jump', to: readParenGroup(masked, i).end - 1 };
}

/**
 * What a brace means at this depth.
 *
 * A `{` at DEPTH 0 opens the body -- the thing the caller is looking for -- while at
 * any deeper depth it is a generic argument (`class X extends Y<{a: number}>`). A `}`
 * only ever closes one.
 *
 * @returns either a `body` action pointing at `i`, or a depth step
 */
function braceAction(c: string, i: number, depth: number): ScanAction {
  if (c === '}') return { kind: 'depth', delta: -1 };
  return depth === 0 ? { kind: 'body', at: i } : { kind: 'depth', delta: 1 };
}

/**
 * Whether this character ends a declaration that has no body.
 *
 * A `;` at depth 0 ends it outright. A newline at depth 0 ends it only when the next
 * line starts a NEW declaration -- otherwise a wrapped header
 * (`class X\n  extends Y`) would be cut in half.
 */
function isDeclarationTerminator(masked: string, i: number, c: string, depth: number): boolean {
  if (depth !== 0) return false;
  if (c === ';') return true;
  return c === '\n' && startsNewDeclaration(masked, i);
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
    if (action.kind === 'body') return action.at;
    if (action.kind === 'no-body') return -1;
    if (action.kind === 'jump') i = action.to;
    depth = nextDepth(depth, action);
  }
  return -1;
}

/**
 * The depth after this action.
 *
 * Depth never goes NEGATIVE: a stray closing bracket in a header must not look like the
 * start of a new group, which would make the next `{` appear to be at depth 0 and be
 * taken for the body.
 */
function nextDepth(depth: number, action: ScanAction): number {
  return action.kind === 'depth' ? Math.max(0, depth + action.delta) : depth;
}

function lineOf(src: string, index: number): number {
  return src.substring(0, index).split('\n').length;
}

/**
 * Offsets of the literals that are the initializer of a named constant.
 *
 * `const NAME = 3` / `const NAME: T = 3`. The magic-number rule skips a number
 * that IS the initializer of a named constant, because the rule's own advice is
 * "consider using a named constant instead" — reporting the constant it just
 * asked for made the violation unfixable.
 *
 * The value's OFFSET is captured rather than the value itself so the literal can
 * be matched positionally: the same number appearing twice must be judged
 * separately, and only the declaration occurrence is exempt.
 *
 * Lives at module scope: as a method it pushed `TypeScriptAdapter` to 16
 * methods, past the god-class threshold of 15, for a pure helper that never
 * reads instance state.
 */
function namedConstLiteralOffsets(masked: string): Set<number> {
  const namedConstRe = /\b(?:const|readonly)\s+[A-Za-z_$][\w$]*\s*(?::[^=;]+)?=\s*(-?\d+(?:\.\d+)?)\s*;/g;
  const offsets = new Set<number>();
  let c: RegExpExecArray | null;
  while ((c = namedConstRe.exec(masked)) !== null) {
    offsets.add(c.index + c[0].lastIndexOf(c[1]));
  }
  return offsets;
}

/** One `import ... from '...'` statement. */
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm;

/** True when the statement this match belongs to is `import type ...`. */
const TYPE_ONLY_IMPORT = /^import\s+type\b/;

type ImportBinding = { name: string; line: number; used: boolean; type?: string };

/**
 * Every binding named by an import statement, plus the span each statement
 * occupies.
 *
 * The spans are returned because usage counting needs the statements BLANKED
 * first: an imported name obviously appears inside its own `import` line, so
 * scanning the raw file marks every import as used. Inlined into the accessor
 * that consumes this, the whole job scored CCN 8 against a baseline of 5.
 */
function collectImportBindings(src: string): {
  entries: ImportBinding[];
  importSpans: Array<[number, number]>;
} {
  const entries: ImportBinding[] = [];
  const importSpans: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_STATEMENT.exec(src)) !== null) {
    const line = lineOf(src, m.index);
    const isTypeOnly = TYPE_ONLY_IMPORT.test(m[0]);
    for (const binding of parseImportClause(m[1].trim(), isTypeOnly)) {
      entries.push({ ...binding, line, used: false });
    }
    importSpans.push([m.index, m.index + m[0].length]);
  }
  return { entries, importSpans };
}

/**
 * `text` with each span replaced by spaces.
 *
 * Spaces rather than deletion: line numbers and column offsets of everything
 * after the span must keep pointing at the original characters.
 */
function blankSpans(text: string, spans: Array<[number, number]>): string {
  let out = text;
  // Reverse order so an earlier span's offsets stay valid while later ones are
  // rewritten; ascending order would shift every subsequent span.
  for (const [start, end] of [...spans].reverse()) {
    out = out.substring(0, start) + ' '.repeat(end - start) + out.substring(end);
  }
  return out;
}

/** True when `name` appears in `body` as a whole identifier, not a property. */
function isReferenced(name: string, body: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`, 'g').test(body);
}

/**
 * A class member declaration: `name(...) {`. Not anchored to line start so
 * minified single-line bodies count too.
 *
 * Module scope because a regex literal is dense in `|` and `?`, which the
 * complexity analyzer counts as branches — inlined, this pattern alone is most of
 * what made `collectClassMethods` score CCN 16 against a baseline of 6.
 */
const CLASS_MEMBER = /(?<![\w$.])(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+|\*\s*)*(\w+)\s*\(/g;

/**
 * Whether a CLASS_MEMBER hit is really a method, rather than a shape that only
 * looks like one.
 *
 * Three rejections, each a distinct reason, so the caller's loop stays a filter:
 * a control-flow keyword (`if (a > 0) {` matches the shape), a call site
 * (`foo(x)` is not a declaration), and a declaration with no body brace.
 */
function isMethodShaped(masked: string, name: string, nameIndex: number, parenIndex: number): boolean {
  if (CONTROL_KEYWORDS.has(name)) return false;
  if (isCallPosition(masked, nameIndex)) return false;
  // Only treat as a method when a body brace follows the parameter list.
  return findBodyBrace(masked, parenIndex) !== -1;
}

/**
 * An arrow-function assignment: `const name = (...) =>` / `let name = x =>`.
 *
 * Module scope because a regex literal is dense in `|` and `?`, which the
 * complexity analyzer counts as branches; inlined, this pattern was most of what
 * made `collectArrowFunctions` score CCN 9 against a baseline of 4.
 */
const ARROW_ASSIGNMENT = /(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?/g;

/** The three quoted states shared by the parameter/paren scanners. */
/** Count top-level, comma-separated parameters in a raw parameter list. */
/**
 * How many parameters a raw parameter list holds.
 *
 * Counting COMMAS at depth 0 is the whole rule: a comma inside a generic
 * (`Map<K, V>`), an array literal or a string does not separate parameters. That is
 * why the scan tracks nesting and quote state before deciding.
 *
 * An empty list is 0, not 1: `()` declares nothing, and the naive "start at 1" would
 * report one parameter for every no-argument function.
 */
/**
 * How many characters of a `=>` / `>=` operator start at `i`, or 0 for anything else.
 *
 * `>` closes a generic parameter list, but in `=>` and `>=` it is an OPERATOR. Counting it
 * as a closer drove the depth negative, after which no later comma looked top-level --
 * measured: `f(cb = (x, y) => x + y, d)` and `f(a = b >= c, d)` each reported 1 parameter
 * instead of 2.
 *
 * A lone `>` PRECEDED BY `=` is the `>` of an arrow whose `=` was consumed on the previous
 * iteration, so it counts as skipped too -- without skipping, the loop would advance past
 * it and still close the depth.
 */
function angleOperatorLength(src: string, i: number): number {
  if (src[i] === '=' && src[i + 1] === '>') return 2;
  if (src[i] === '>' && (src[i + 1] === '=' || src[i - 1] === '=')) return 1;
  return 0;
}

function countParams(rawList: string): number {
  const trimmed = rawList.trim();
  if (trimmed === '') return 0;

  const depth = { value: 0 };
  const state = newQuoteState();
  let count = 1;

  for (let i = 0; i < trimmed.length;) {
    if (inQuotedState(state)) {
      i += advanceQuoteState(trimmed, i, state);
      continue;
    }
    const skipped = angleOperatorLength(trimmed, i);
    if (skipped > 0) { i += skipped; continue; }
    if (!deepensParamNesting(trimmed[i], depth)) count += 1;
    i++;
  }
  return count;
}

/**
 * Whether this character is NOT a top-level parameter separator.
 *
 * Absorbing the decision keeps the loop to one test. A delimiter changes depth; anything
 * else is a separator only when it is a top-level comma.
 *
 * A QUOTE returns true but does NOT open a state here, and that is correct: `countParams`
 * receives text that `readParenGroup` already scanned, so a quoted run has been resolved
 * to one opaque item before this sees it. The earlier wording ("a quote opens a state")
 * read as a promise this function does not keep, and three reviewers concluded a comma
 * inside a string was counted as a separator -- it is not. Measured on four shapes
 * including `f(a: string = "1,2,3", b: number)` -> 2.
 *
 * @returns true when the caller should not count a new parameter
 */
function deepensParamNesting(c: string, depth: { value: number }): boolean {
  if (isQuote(c)) return true;
  return applyDelimiter(c, depth) || c !== ',' || depth.value !== 0;
}

/** What one step of the paren-group scan did, so the caller can react. */
type ParenStep =
  | { kind: 'consumed'; next: number }
  | { kind: 'closed'; end: number };

/**
 * Advance one step through a paren group.
 *
 * Extracted from `readParenGroup` (#620) so the three-way decision -- inside a
 * literal, opening a literal, or structural bracket -- reads as one rule instead
 * of being folded into the loop that also owns depth and substring slicing.
 *
 * A literal is entered through `advanceQuoteState` at the SAME index rather than
 * consumed: that call flips the state on the opening quote and reports one
 * character consumed, so re-scans resume one past the quote with the state set.
 *
 * @param depth running paren depth, updated in place for structural brackets
 * @returns the next index to read, or the offset just past the closing paren
 */
function stepParenGroup(
  src: string,
  i: number,
  state: QuoteState,
  depth: { value: number },
): ParenStep {
  if (inQuotedState(state)) {
    return { kind: 'consumed', next: i + advanceQuoteState(src, i, state) };
  }

  const c = src[i];
  if (isQuote(c)) {
    // Entering a literal: flip state here, resume at the next character.
    advanceQuoteState(src, i, state);
    return { kind: 'consumed', next: i + 1 };
  }
  if (c === '(') {
    depth.value++;
    return { kind: 'consumed', next: i + 1 };
  }
  if (c === ')') {
    depth.value--;
    if (depth.value === 0) return { kind: 'closed', end: i + 1 };
  }
  return { kind: 'consumed', next: i + 1 };
}

/**
 * Extract the balanced `( ... )` group that starts at `open`.
 * Returns the inner text and the index just past the closing paren.
 */
function readParenGroup(src: string, open: number): { inner: string; end: number } {
  const state = newQuoteState();
  const depth = { value: 0 };

  for (let i = open; i < src.length;) {
    const step = stepParenGroup(src, i, state, depth);
    if (step.kind === 'closed') {
      return { inner: src.substring(open + 1, step.end - 1), end: step.end };
    }
    i = step.next;
  }
  return { inner: src.substring(open + 1), end: src.length };
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

/** Sentinel for "this arrow has a bare parameter, not a parenthesised list". */
const PAREN_MISSING = -1;

/** A single-identifier parameter followed by `=>`. */
const BARE_PARAM_ARROW = /^\s*(\w+)\s*=>/;

/** The bare parameter itself, for measuring where it ends. */
const BARE_PARAM = /^\s*(\w+)/;

/** What follows a parameter list: an optional return type, then `=>`. */
const ARROW_HEAD = /^\s*(?::[^=]+)?=>/;

/**
 * The index of an arrow's `{` block body, or -1 for a concise body.
 *
 * The brace is accepted only when it comes straight after `=>`: a `{` appearing later
 * belongs to the expression the arrow returns (an object literal is `=> ({ ... })`),
 * and treating it as a block would measure a body that does not exist.
 */
function blockBodyOpen(masked: string, afterParams: number): number {
  const braceAfter = masked.indexOf('{', afterParams);
  if (braceAfter === -1) return -1;
  const isBlockBody = /^\s*(?::[^=]+)?=>\s*\{/.test(masked.substring(afterParams, braceAfter + 1));
  return isBlockBody ? braceAfter : -1;
}

/**
 * The index of an arrow's parameter-list `(`, or PAREN_MISSING for a bare parameter.
 *
 * Both shapes are legal: `(x) => ...` and `x => ...`. A parenthesised group is preferred
 * when present, because that is the common form.
 *
 * Module-level rather than a method: the adapter class is already at its method-count
 * ceiling, and this needs nothing from `this`.
 */
function arrowParenIndex(rest: string, scanFrom: number): number {
  return /^\s*\(/.test(rest) ? scanFrom + rest.indexOf('(') : PAREN_MISSING;
}

export class TypeScriptAdapter extends BaseAdapter implements Adapter {
  /**
   * This adapter implements rules of its own, so the gate may report its files
   * as genuinely examined. Adapters that only make a language detectable leave
   * this at the BaseAdapter default (`false`) and are reported as unanalysed.
   */
  readonly declaresRuleCoverage: boolean = true;

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
    const masked = this.maskedSource;
    const namedConstOffsets = namedConstLiteralOffsets(masked);
    const results: Array<{ value: number; line: number }> = [];

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
    const { entries, importSpans } = collectImportBindings(src);
    // Usage is judged against the file with every import statement blanked out.
    // Inlined, this accessor scored CCN 8 against a baseline of 5 because it did
    // three jobs at once: find the imports, mask them, then count references.
    const body = blankSpans(src, importSpans);
    for (const entry of entries) entry.used = isReferenced(entry.name, body);
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
      nestingDepth: hasBraces ? maxControlNesting(maskLiterals(body)) : 0,
      // The RAW body: `on('error', ...)` needs its string literal intact, and
      // masking blanks string bodies. try/catch is a keyword and is unaffected.
      hasTryCatch: hasErrorHandling(body),
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
      if (!claimMember(seen, m[1], nameIndex)) continue;
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
    let m: RegExpExecArray | null;
    while ((m = CLASS_MEMBER.exec(masked)) !== null) {
      // The pattern ends with `\(`, so the match's last character IS the opening
      // paren. Re-searching with indexOf() could drift to a later `(` inside the
      // parameter list or a type annotation, which corrupted the reported span.
      const parenIndex = m.index + m[0].length - 1;
      const nameIndex = parenIndex - m[1].length;
      if (!isMethodShaped(masked, m[1], nameIndex, parenIndex)) continue;
      if (!claimMember(seen, m[1], nameIndex)) continue;
      found.push(this.buildFunction(m[1], 'method', nameIndex, parenIndex, findBodyBrace(masked, parenIndex)));
    }
  }

  /** Arrow consts / assignments: `const name = (...) =>` / `name = x =>`. */
  private collectArrowFunctions(seen: Set<string>, found: FunctionMetrics[]): void {
    const masked = this.maskedSource;
    let m: RegExpExecArray | null;
    while ((m = ARROW_ASSIGNMENT.exec(masked)) !== null) {
      const arrow = this.parseArrowAt(m, ARROW_ASSIGNMENT.lastIndex);
      if (!arrow) continue;
      const nameIndex = m.index + m[0].length - m[1].length;
      if (!claimMember(seen, m[1], nameIndex)) continue;
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
    const parenIndex = arrowParenIndex(rest, scanFrom);
    if (parenIndex === PAREN_MISSING && !BARE_PARAM_ARROW.test(rest)) return null;

    const afterParams = parenIndex === PAREN_MISSING
      ? scanFrom + (BARE_PARAM.exec(rest) as RegExpExecArray)[0].length
      : readParenGroup(this.fileContent, parenIndex).end;
    if (!ARROW_HEAD.test(masked.substring(afterParams))) return null;

    return { parenIndex, afterParams, bodyOpen: blockBodyOpen(masked, afterParams) };
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
    // Scan the MASKED slice, matching the named-function path above: a `}` or
    // `)` inside a string literal would otherwise unbalance the brace pairing
    // and drop the nesting inside that block. `code` stays raw for the reported
    // source and the regex-based checks below.
    const maskedCode = this.maskedSource.substring(arrow.bodyOpen, bodyEnd);
    const endLine = lineOf(src, bodyEnd);
    return {
      name,
      type: 'arrow',
      line: startLine,
      startLine,
      endLine: startLine,
      length: Math.max(1, endLine - startLine + 1),
      paramCount: arrow.parenIndex === -1 ? 1 : countParams(readParenGroup(src, arrow.parenIndex).inner),
      nestingDepth: maxControlNesting(maskedCode),
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
      // Members are counted on the MASKED body: the prose in a JSDoc line like
      // "three separate events (close / error / timeout)" reads as `events(` and
      // was counted as a method, as did `unknown` from a `(): unknown {` return
      // type. Masking blanks comments and string bodies, so only real code has
      // braces and parens left.
      const maskedBody = masked.substring(bodyOpen, bodyEnd);

      // Count members declared at the class body's TOP brace depth. A call
      // inside a method body sits one level deeper, which is the only signal
      // that separates `{ helper(1); }` from `{ async run() { ... }`.
      // Earlier attempts compared the preceding character and reported 66
      // methods for a class declaring 30 -- every call site counted once.
      const methods = countTopLevelMembers(maskedBody);

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


/**
 * Does this function handle failures?
 *
 * `try`/`catch` is one way, and for a function that owns a child process it is
 * not the idiomatic one: Node reports spawn failures through an `'error'`
 * event, and a `try` around `spawn()` would never see them. Treating the event
 * listener as unhandled reported `runMutmut` for having "I/O without error
 * handling" while it was in fact the only handler for that failure mode --
 * a warning no correct edit could clear, which is how a rule loses its meaning.
 *
 * `'error'` is matched as a QUOTED argument (`on('error', ...)`) so that a
 * string that merely contains the word does not qualify.
 */
function hasErrorHandling(body: string): boolean {
  return TRY_BLOCK.test(body) || ERROR_LISTENER.test(body);
}

/**
 * The two handler shapes, as module-level constants.
 *
 * ccn-report locates a function body by counting brackets on its lines; a regex
 * literal INSIDE the body makes that extent ambiguous, and the row comes back
 * "CCN could not be span-verified" -- a Gate 3 block. Brackets and braces in the
 * patterns are written as character classes for the same reason.
 */
const TRY_BLOCK = /\btry\s*[{]/;
const ERROR_LISTENER = /\bon\s*[(]\s*['"]error['"]\s*,/;
