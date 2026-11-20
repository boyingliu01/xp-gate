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
    let depth = 0;
    let seenBrace = false;
    for (let i = startPos; i < blanked.length; i++) {
      if (blanked[i] === '{') {
        depth++;
        seenBrace = true;
      } else if (blanked[i] === '}') {
        depth--;
        if (seenBrace && depth === 0) {
          return this.fileContent.substring(startPos, i + 1);
        }
      }
    }
    return this.fallbackCodeBlock(startPos, maxFallback);
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
    if (ch === '{') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === '}') {
      depth--;
    }
  }
  return maxDepth > 0 ? maxDepth : 0;
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
function blankBlockComment(code: string, start: number): { emit: string; last: number } {  let i = start + 2;
  let emit = '  ';
  while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
    emit += ' ';
    i++;
  }
  if (i < code.length) {
    emit += '  ';
    i++;
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
function blankHeredoc(code: string, start: number): { emit: string; last: number } | undefined {
  HEREDOC_OPEN.lastIndex = start;
  const opener = HEREDOC_OPEN.exec(code);
  if (!opener) return undefined;

  const terminator = opener[2];
  let i = start + opener[0].length;
  let emit = ' '.repeat(opener[0].length);

  while (i < code.length) {
    const lineStart = i;
    let lineEnd = code.indexOf('\n', i);
    if (lineEnd < 0) lineEnd = code.length;
    const line = code.slice(lineStart, lineEnd);
    const trimmed = line.trimStart();

    if (trimmed.startsWith(terminator)) {
      const afterWord = trimmed.charAt(terminator.length);
      // Followed by end of line or a statement terminator -- not a longer word.
      if (afterWord === '' || /[;,)\]}]/.test(afterWord) || /\s/.test(afterWord)) {
        emit += ' '.repeat(line.length);
        i = lineEnd;
        break;
      }
    }
    emit += ' '.repeat(line.length);
    if (lineEnd < code.length) {
      emit += '\n';
      i = lineEnd + 1;
    } else {
      i = lineEnd;
    }
  }
  return { emit, last: i };
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

  // `//` versus `/*`: same first character, so this needs lookahead.
  if (ch === '/') {
    if (code[index + 1] === '/') return blankLineComment(code, index);
    return code[index + 1] === '*' ? blankBlockComment(code, index) : undefined;
  }
  // `<<<` opens a heredoc/nowdoc; a lone `<` is an operator.
  if (ch === '<' && code[index + 1] === '<' && code[index + 2] === '<') {
    return blankHeredoc(code, index);
  }
  return undefined;
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
function stripPhpLiterals(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const slice = blankLiteralAt(code, i);
    if (!slice) {
      out += code[i];
      continue;
    }
    out += slice.emit;
    // `last` is the index the helper stopped AT (the terminating newline or
    // closing delimiter, already emitted). Resume just past it; the loop's own
    // `i++` would otherwise consume one character twice.
    i = slice.last;
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

function scanParamList(stripped: string, open: number): ParamScan {
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let commas = 0;
  let sawContent = false;
  for (let i = open; i < stripped.length; i++) {
    const ch = stripped[i];
    const delta = BRACKET_DELTA[ch];

    // Brackets are a table lookup, not a branch cascade: the cascade measured
    // CCN 14-15 against a block threshold of 10 while each arm was one increment.
    if (delta) {
      parens += delta[0];
      brackets += delta[1];
      braces += delta[2];
      if (parens === 0 && i > open) break;
      continue;
    }

    if (!/\s/.test(ch)) sawContent = true;
    // A comma separates parameters only at the list's own outermost level.
    if (ch === ',' && parens === 1 && brackets === 0 && braces === 0) commas++;
  }
  return { commas, sawContent };
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
