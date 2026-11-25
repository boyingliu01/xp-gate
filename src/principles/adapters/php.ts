import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * PHP adapter for the principles engine (Gate 4).
 *
 * Why this file exists: `analyzer.ts`'s `adapterMap` had no `.php` entry, so
 * `getAdapterForFile('a.php')` returned null while `gate-4.sh` had already been
 * widened to accept the extension. That is the #717 shape exactly -- a file is
 * accepted by the filter and then silently inspected by nobody, which reads as
 * "Gate 4 ran and found nothing".
 *
 * Regex-based on purpose, like the C/C++/Objective-C adapters: the engine has no
 * PHP AST and inventing a shallow one would report confident findings it cannot
 * verify. An under-reported file is the acceptable failure; a fabricated finding
 * is not.
 *
 * PDF note: the two forms below cover the declaration shapes the rules act on.
 * Deliberately NOT matched: closures assigned with `$f = function () {}` (the
 * binding is a variable, so a "function" finding would be attributed to `$f`
 * with no name a human recognises) and arrow functions `fn($x) => ...`, which
 * have no brace body for the nesting rules to walk.
 */
/** Where a brace scan ended: the last depth-zero position, and whether it balanced. */
interface BraceScan {
  endPos: number;
  balanced: boolean;
}

/**
 * Find the FIRST index at which brace depth returned to zero, scanning `code`
 * from `startPos`.
 *
 * The first crossing is the declaration's own closing brace: from the
 * declaration's start the depth goes up at its `{` and back to zero exactly at
 * its `}`, so the first zero-crossing cannot belong to an enclosing scope.
 *
 * ## Why not the last crossing (the original implementation)
 *
 * It took the LAST zero-crossing of the whole file, on the reasoning that a
 * nested class or closure sits INSIDE the declaration and therefore cannot be
 * the last crossing. That reasoning only holds for the declaration that ends
 * the file. For a method inside a class the last zero-crossing is the CLASS's
 * closing brace, so the extracted block ran from the method's first line to the
 * end of the file. `length` is derived from that block, so every method reported
 * "distance to EOF":
 *
 *     public function first() { return 1; }   // 1 line -> reported 74 lines
 *
 * Measured on a real 475-line file: a 33-line constructor was reported as 423
 * lines, a 5-line helper as 93. Every PHP file longer than the 50-line threshold
 * consequently produced unfixable `clean-code.long-function` warnings -- 89 of
 * them across 6 files, while an independent measurement found zero functions
 * actually over 50 lines.
 *
 * ## Why the "first crossing" was believed unsafe
 *
 * The earlier comment recorded that an unterminated heredoc leaves unmatched
 * `{` in the text, so the first zero-crossing lands mid-body. That hazard is
 * handled upstream: `extractCodeBlock` scans a `stripPhpLiterals()` view, where
 * heredoc/nowdoc bodies are blanked, so their braces never reach `stepDepth`.
 * A test in php.test.ts pins this ("is not confused by a heredoc containing
 * braces").
 *
 * `balanced` is false when the scan never returns to zero, the signal that the
 * input is malformed and no crossing is trustworthy.
 */
function firstBalancedEnd(code: string, startPos: number): BraceScan {
  let depth = 0;
  let seenBrace = false;
  for (let i = startPos; i < code.length; i++) {
    const step = stepDepth(code[i], depth, seenBrace);
    depth = step.depth;
    seenBrace = step.seenBrace;
    if (step.closedAtEnd) return { endPos: i + 1, balanced: true };
  }
  return { endPos: -1, balanced: depth === 0 };
}

export class PhpAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const lower = this.filePath.toLowerCase();
    if (lower.endsWith('.php') || lower.endsWith('.phtml')) {
      return 'php';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return this.createParseResult('php');
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    // `function name(` with optional leading modifiers/`&` (by-reference return)
    // and an optional return type after the closing paren. The `$` lookahead the
    // closure form would need is intentionally absent -- see the class comment.
    const fnRegex = /(?:^|[\s;{}])(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*(\w+)\s*\(/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      const name = match[1];
      // A method whose name collides with a PHP keyword is not a declaration.
      const kind = name === '__construct' ? 'constructor' : 'function';
      const found = this.createCodeMatch(name, kind, match.index);
      this.annotateMetrics(found);
      functionMatches.push(found);
    }

    return functionMatches;
  }

  /**
   * Cut the function body with heredoc/nowdoc awareness.
   *
   * The inherited implementation counts braces character by character, so a
   * heredoc containing `{` grows its brace depth without any matching `}` in real
   * code. Measured on a method whose heredoc held `{ { {`: the cut stopped inside
   * the heredoc and the rest of the method -- including a five-level `if` chain --
   * never reached the rules at all, reporting nestingDepth 1.
   *
   * Blanking the literals first means the brace scan only ever sees code, and the
   * cut lands on the method's real closing brace. The returned text is the
   * ORIGINAL slice, not the blanked one: `length` is a line count of the source as
   * written, and `code` is what a human reads in a finding.
   */
  protected extractCodeBlock(startPos: number, maxFallback: number = 100): string {
    const blanked = stripPhpLiterals(this.fileContent);
    const scan = firstBalancedEnd(blanked, startPos);

    // Unterminated heredoc: the text never rebalances, so no crossing is a real
    // boundary. Fall back to the last `}` in the file rather than a boundary that
    // is provably wrong; a malformed file must degrade to less checking, never to
    // a quiet pass.
    if (!scan.balanced) {
      const lastClose = blanked.lastIndexOf('}');
      return lastClose > startPos
        ? this.fileContent.substring(startPos, lastClose + 1)
        : this.fallbackCodeBlock(startPos, maxFallback);
    }
    if (scan.endPos <= 0) return this.fallbackCodeBlock(startPos, maxFallback);
    return this.fileContent.substring(startPos, scan.endPos);
  }

  /**
   * Add the fields the Gate 4 rules actually read.
   *
   * `createCodeMatch` supplies only {name, type, line, code}. Every rule that
   * asks a question about a function's SHAPE reads `nestingDepth`, `paramCount`,
   * `length` or `hasTryCatch` instead -- so without this, PHP matched the
   * declaration and then silently satisfied nothing. Measured: identical
   * five-level nesting reported one ERROR as `Same.ts` and "No violations found"
   * as `Legacy.php`.
   *
   * This is the #446 shape the csharp adapter's comment documents: a missing
   * field is invisible, because the rule finds nothing to report rather than
   * reporting that it could not measure.
   */
  private annotateMetrics(target: unknown): void {
    const m = target as Record<string, unknown>;
    const body = typeof m.code === 'string' ? m.code : '';

    // Strip literals ONCE and derive every metric from that view.
    //
    // `hasTryCatch` originally tested the RAW body, so a method whose only
    // `try {` sat inside a string or a comment reported error handling it did not
    // have -- measured: a method holding `$s = 'try { x } catch (E $e) { }'`
    // returned true. missing-error-handling is the rule that consumes this field,
    // so the mistake made the rule stay silent on a method with no catch at all.
    const code = stripPhpLiterals(body);

    m.length = body === '' ? 0 : body.split(/\r?\n/).length;
    m.nestingDepth = measureNesting(code);
    m.hasTryCatch = /\btry\s*\{/.test(code) && /\bcatch\s*[({]/.test(code);
    m.paramCount = countParameters(code);
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /(?:^|[\s;{}])class\s+(\w+)(?:\s+extends\s+([\w\\]+))?/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[1], 'class', match.index));
    }

    // Interfaces and traits are separate PHP type declarations. Recorded with
    // their own type rather than folded into `class`: an `interface` reported as
    // a class would be counted by the SOLID rules that reason about concrete
    // implementations.
    const otherRegex = /(?:^|[\s;{}])(interface|trait|enum)\s+(\w+)/g;
    while ((match = otherRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[2], match[1], match.index));
    }

    return classMatches;
  }
}

/**
 * Deepest run of `{` in a function body.
 *
 * String literals and comments are blanked out first. PHP code is dense with
 * braces inside strings (`sprintf('{{%s}}')`, JSON blobs, HTML templates) and the
 * base class's `advanceBraceTracker` counts every one of them -- a method whose
 * only "nesting" is a template string would be reported as deeply nested, and the
 * rule would be turned off within a week.
 *
 * The body's own braces contribute one level, so a flat method reads 1. That
 * matches how the csharp adapter measures and how the rule's threshold is tuned.
 */
function measureNesting(stripped: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const ch of stripped) {
    depth = stepDepth(ch, depth, false).depth;
    maxDepth = Math.max(maxDepth, depth);
  }
  return maxDepth > 0 ? maxDepth : 0;
}

/**
 * Apply one character to a brace depth.
 *
 * `depth` may go NEGATIVE, and the callers depend on it: a `}` before any `{` is a
 * stray closer, and tracking it keeps a later `{` from being mistaken for a balanced
 * block. `closedAtEnd` is true only when a brace pair closed back to zero -- which is
 * what makes the LAST balanced block findable rather than the first.
 */
function stepDepth(ch: string, depth: number, seenBrace: boolean) {
  if (ch === '{') return { depth: depth + 1, seenBrace: true, closedAtEnd: false };
  if (ch !== '}') return { depth, seenBrace, closedAtEnd: false };
  const next = depth - 1;
  return { depth: next, seenBrace, closedAtEnd: seenBrace && next === 0 };
}

/**
 * Blank one line comment starting at `start`, returning the replacement and the
 * index of its terminating newline (or end of input).
 */
function blankLineComment(code: string, start: number): { emit: string; last: number } {
  let i = start;
  let emit = '';
  while (i < code.length && code[i] !== '\n') {
    emit += ' ';
    i++;
  }
  return { emit, last: i };
}

/** Blank one block comment, including its delimiters. */
function blankBlockComment(code: string, start: number): { emit: string; last: number } {
  let i = start + 2;
  let emit = '  ';
  while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
    emit += ' ';
    i++;
  }
  if (i < code.length) {
    emit += '  ';
    // Advance PAST the closing `*` and `/` (two characters, two blanks).
    //
    // `last` is the STOP index, and the caller resumes at `last` — the same
    // contract as blankLineComment. Incrementing once here made the helper
    // consume `*` but stop on `/`, so `stripPhpLiterals` then swallowed the
    // character after `*/` as well. Each block comment therefore shortened the
    // output by one character, and because `stripPhpLiterals` promises
    // "preserving length so brace positions stay meaningful", every position
    // AFTER the first block comment drifted. Measured: a 30,587-byte file came
    // back 181 bytes short, and `extractCodeBlock` — which re-uses the raw
    // match index against the blanked view — cut a 9-line method into the
    // 113-line span up to the next balanced brace.
    i += 2;
  }
  return { emit, last: i };
}

/** Blank one quoted string, keeping the delimiters so positions stay aligned. */
function blankQuoted(code: string, start: number): { emit: string; last: number } {
  const quote = code[start];
  let i = start + 1;
  let emit = quote;
  while (i < code.length && code[i] !== quote) {
    // A backslash escapes the next character in both quoted forms.
    if (code[i] === '\\') {
      emit += '  ';
      i += 2;
      continue;
    }
    emit += ' ';
    i++;
  }
  if (i < code.length) {
    emit += quote;
    i++;
  }
  return { emit, last: i };
}

/** A heredoc/nowdoc opener: `<<<SQL`, `<<<"SQL"`, `<<<'SQL'`. */
const HEREDOC_OPEN = /<<<[ \t]*(["']?)([A-Za-z_]\w*)\1[ \t]*\r?\n/y;

/**
 * Blank a heredoc or nowdoc block from its `<<<` opener to its closing
 * identifier.
 *
 * These MUST be stripped, and the earlier assumption that leaving them alone only
 * caused under-counting was wrong -- measured, it caused false positives:
 *
 *     function sqlTemplate() { $sql = <<<SQL  { { { { {  SQL;  ... }
 *       -> nestingDepth 6 on a method with no nesting
 *     function heredocTry() { $s = <<<TXT  try { x } catch (E $e) { }  TXT; ... }
 *       -> hasTryCatch true with no try/catch in code
 *
 * deep-nesting's threshold is 4, so a SQL template or an inline CSS/JS block was
 * enough to report a violation against correct code. False positives in a gate
 * are resolved by switching the rule off, which is the expensive direction.
 *
 * The closing identifier must start a line (optional indentation, PHP 7.3+) and be
 * followed by a non-identifier character, so a line whose content merely starts
 * with the same word does not terminate the block early.
 */
/**
 * Whether this line closes the heredoc.
 *
 * The terminator must be followed by END OF LINE, whitespace, or a
 * statement/expression terminator -- not the start of a longer word. The comma matters:
 * PHP allows `SQL,` when the heredoc is an array element, and missing that case
 * over-blanked silently, the same quiet failure class as truncation.
 */
function closesHeredoc(line: string, terminator: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(terminator)) return false;
  const afterWord = trimmed.charAt(terminator.length);
  return afterWord === '' || /[\s;,\]})]/.test(afterWord);
}

/** The index just past this line, newline included. */
function nextLineStart(code: string, lineEnd: number): number {
  return lineEnd < code.length ? lineEnd + 1 : lineEnd;
}

/**
 * A heredoc with no terminator is MALFORMED source, and the honest reading is to treat
 * the opener as ordinary text: with no closing marker there is no way to know where the
 * string ends, so the gate reports what the braces literally say rather than guessing a
 * boundary.
 *
 * The alternative -- blanking to end-of-file -- silently disabled every rule for the rest
 * of the method (measured: a five-level `if` chain reported depth 1 and length 4). A
 * malformed file must degrade to LESS CHECKING on that construct, never to a quiet pass
 * on the whole method.
 */
function unterminatedHeredoc(code: string, start: number, openerLength: number) {
  const last = start + openerLength - 1;
  return { emit: code.slice(start, last), last };
}

function blankHeredoc(code: string, start: number): { emit: string; last: number } | undefined {
  HEREDOC_OPEN.lastIndex = start;
  const opener = HEREDOC_OPEN.exec(code);
  if (!opener) return undefined;

  const terminator = opener[2];
  let i = start + opener[0].length;
  let emit = ' '.repeat(opener[0].length);

  while (i < code.length) {
    const lineEnd = nextLineEnd(code, i);
    const line = code.slice(i, lineEnd);
    const closes = closesHeredoc(line, terminator);
    // Cover the line AND the newline that ends it. Advancing to nextLineStart
    // without emitting the newline shortened the output by one character per
    // heredoc line, which broke the length contract `stripPhpLiterals` promises
    // and shifted every brace position after the heredoc.
    const span = nextLineStart(code, lineEnd) - i;
    emit += ' '.repeat(span);
    i = nextLineStart(code, lineEnd);
    // `last` is the STOP index (exclusive): the caller resumes there, and its
    // own `i++` moves one further. The terminating line's newline is already in
    // `emit`, so stop at nextLineStart, not at lineEnd, or it is emitted twice.
    if (closes) return { emit, last: nextLineStart(code, lineEnd) };
  }
  return unterminatedHeredoc(code, start, opener[0].length);
}

/** The index of this line's terminating newline, or the end of the text. */
function nextLineEnd(code: string, from: number): number {
  const found = code.indexOf('\n', from);
  return found < 0 ? code.length : found;
}

/**
 * Recognise the literal form starting at `index`, or return undefined when the
 * character is ordinary code.
 *
 * One dispatcher rather than an `if/else if` chain inside the scan loop: the
 * chain measured CCN 13 on its own, over the Gate 3 block threshold, and the
 * forms are a lookup rather than a cascade.
 *
 * `#` is checked before the heredoc opener would ever see it, and `<<<` is
 * checked before `<` could be read as an operator, so the order of these tests is
 * load-bearing rather than stylistic.
 */
/**
 * Single-character literal openers. `#` and both quote forms are unambiguous, so
 * they need no lookahead and live in a table rather than in the branch chain.
 */
const SINGLE_CHAR_LITERAL: Readonly<Record<string, (code: string, at: number) => { emit: string; last: number }>> = {
  '#': blankLineComment,
  "'": blankQuoted,
  '"': blankQuoted,
};

function blankLiteralAt(code: string, index: number): { emit: string; last: number } | undefined {
  const ch = code[index];

  const single = SINGLE_CHAR_LITERAL[ch];
  if (single) return single(code, index);

  if (ch === '/') return blankSlashAt(code, index);
  if (ch === '<') return blankLessThanAt(code, index);
  return undefined;
}

/**
 * `//` versus `/*`: the same first character, so only lookahead tells them apart.
 *
 * A lone `/` is DIVISION, and blanking from it would swallow the rest of the line.
 */
function blankSlashAt(code: string, index: number) {
  if (code[index + 1] === '/') return blankLineComment(code, index);
  return code[index + 1] === '*' ? blankBlockComment(code, index) : undefined;
}

/**
 * `<<<` opens a heredoc or nowdoc; a lone `<` (or `<<`) is an OPERATOR.
 *
 * All three characters are required: `$a << 2` is a bit shift, and treating it as a
 * heredoc opener would blank the rest of the file looking for a terminator.
 */
function blankLessThanAt(code: string, index: number) {
  const isHeredoc = code[index + 1] === '<' && code[index + 2] === '<';
  return isHeredoc ? blankHeredoc(code, index) : undefined;
}

/**
 * Replace string/comment/heredoc contents with spaces, preserving length so brace
 * positions stay meaningful.
 *
 * Covers every literal form PHP code actually uses: single- and double-quoted
 * strings, `//` and `#` line comments, block comments, and heredoc/nowdoc blocks.
 * It is still not a full lexer, but every remaining omission must fail in the
 * UNDER-counting direction -- leaving a constructor out can only make a gate
 * quieter, never fabricate a finding.
 *
 * Split into one helper per literal form because the single-loop version measured
 * CCN 23: seven branch points sharing one index variable read as deeply nested
 * even though each branch is trivial.
 */
export function stripPhpLiterals(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const slice = blankLiteralAt(code, i);
    if (!slice) {
      out += code[i];
      continue;
    }
    out += slice.emit;
    // `last` is the index the helper stopped AT, already past everything it
    // emitted. The loop's own `i++` supplies the final step, so resume at
    // `last - 1`; assigning `last` directly skipped one source character per
    // literal.
    //
    // That off-by-one broke the length contract this function exists to keep
    // ("preserving length so brace positions stay meaningful"). Measured on a
    // 30,587-byte PHP file: 181 bytes short, and `extractCodeBlock` — which
    // reuses the raw match index against this blanked view — cut a 9-line method
    // into a 113-line span reaching the next balanced brace.
    i = slice.last - 1;
  }
  return out;
}

/**
 * What a parameter list scan found: the outermost-level comma count and whether
 * any non-whitespace sat between the parentheses.
 */
interface ParamScan {
  commas: number;
  sawContent: boolean;
}

/**
 * Scan from `open` (the `(`) to its matching `)`, counting commas that separate
 * parameters.
 *
 * ALL THREE bracket pairs are tracked, not just parentheses. A default value can
 * be a short-array literal, and this scanner originally counted parens only:
 * measured, `function shortArray($a = [1,2], $b = [3,4])` reported FOUR
 * parameters instead of two. `too-many-params` blocks above 7, so a handful of
 * array defaults turned correct code into a false block -- the expensive
 * direction, and one a user resolves by disabling the rule.
 *
 * Curly braces are tracked for the same reason (`$a = ['k' => ['x' => 1]]`).
 * Literals are already blanked by the caller, so braces inside strings do not
 * reach this scan.
 */
/** Nesting delta contributed by each bracket character. */
const BRACKET_DELTA: Readonly<Record<string, readonly [number, number, number]>> = {
  '(': [1, 0, 0],
  ')': [-1, 0, 0],
  '[': [0, 1, 0],
  ']': [0, -1, 0],
  '{': [0, 0, 1],
  '}': [0, 0, -1],
};

/**
 * Whether the parameter list just closed.
 *
 * `i > open` guards the scan's own opening paren: without it the loop ends on its first
 * character and every function reports zero parameters.
 */
function closesList(parens: number, i: number, open: number): boolean {
  return parens === 0 && i > open;
}

/** The running state of one parameter-list scan. */
interface ParamScanState {
  parens: number;
  brackets: number;
  braces: number;
  commas: number;
  sawContent: boolean;
}

/**
 * Consume one character of a parameter list.
 *
 * @returns whether the list just closed, so the caller stops
 */
function consumeParamChar(ch: string, i: number, open: number, state: ParamScanState): boolean {
  const delta = BRACKET_DELTA[ch];
  // Brackets are a table lookup, not a branch cascade: the cascade measured CCN 14-15
  // against a block threshold of 10 while each arm was one increment.
  if (delta) {
    state.parens += delta[0];
    state.brackets += delta[1];
    state.braces += delta[2];
    return closesList(state.parens, i, open);
  }
  if (isParamSeparator(ch, state)) state.commas++;
  if (!/\s/.test(ch)) state.sawContent = true;
  return false;
}

function scanParamList(stripped: string, open: number): ParamScan {
  const state: ParamScanState = { parens: 0, brackets: 0, braces: 0, commas: 0, sawContent: false };
  for (let i = open; i < stripped.length; i++) {
    if (consumeParamChar(stripped[i], i, open, state)) break;
  }
  return { commas: state.commas, sawContent: state.sawContent };
}

/** The nesting depths at one point in a parameter list. */
interface ParamDepth {
  parens: number;
  brackets: number;
  braces: number;
}

/**
 * Whether this character separates two parameters.
 *
 * Only a comma at the list's OWN outermost level: `parens === 1` because the scan
 * started at the opening paren, and no array or brace nesting open. A comma inside a
 * default value (`[1, 2]`, `foo(1, 2)`, `'a,b'`) is content, not a separator.
 */
function isParamSeparator(ch: string, depth: ParamDepth): boolean {
  if (ch !== ',') return false;
  return depth.parens === 1 && depth.brackets === 0 && depth.braces === 0;
}

/**
 * Count a declaration's parameters from its `code` (which starts at the
 * `function` keyword and therefore includes the parameter list).
 *
 * Returns 0 for an empty list. Commas inside a default value -- array literals,
 * nested calls, string content -- are not counted, because the scan only tallies
 * at the list's outermost level.
 */
function countParameters(stripped: string): number {
  const open = stripped.indexOf('(');
  if (open < 0) return 0;
  const scan = scanParamList(stripped, open);
  if (!scan.sawContent) return 0;
  return scan.commas + 1;
}
