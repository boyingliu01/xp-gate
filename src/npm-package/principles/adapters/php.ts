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

    m.length = body === '' ? 0 : body.split(/\r?\n/).length;
    m.nestingDepth = measureNesting(body);
    m.hasTryCatch = /\btry\s*\{/.test(body) && /\bcatch\s*[({]/.test(body);
    m.paramCount = countParameters(body);
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
function measureNesting(body: string): number {
  const stripped = stripPhpLiterals(body);
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
function blankBlockComment(code: string, start: number): { emit: string; last: number } {
  let i = start + 2;
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

/**
 * Replace string/comment contents with spaces, preserving length so brace
 * positions stay meaningful.
 *
 * Covers the literal forms that actually appear in PHP: single- and
 * double-quoted strings, line comments (`//`, `#`), and block comments.
 * Deliberately not a full lexer -- heredoc/nowdoc are not stripped, which can
 * only cause UNDER-counting, the acceptable direction per the class comment.
 *
 * Split into one helper per literal form because the single-loop version measured
 * CCN 23: seven branch points sharing one index variable read as deeply nested
 * even though each branch is trivial.
 */
/**
 * Recognise the literal form starting at `index`, or return undefined when the
 * character is ordinary code.
 *
 * One dispatcher rather than an `if/else if` chain inside the scan loop: the
 * chain measured CCN 13 on its own, over the Gate 3 block threshold, and the
 * forms are a lookup rather than a cascade.
 */
function blankLiteralAt(code: string, index: number): { emit: string; last: number } | undefined {
  const ch = code[index];
  const next = code[index + 1];
  if (ch === '/' && next === '/') return blankLineComment(code, index);
  if (ch === '/') return next === '*' ? blankBlockComment(code, index) : undefined;
  if (ch === '#') return blankLineComment(code, index);
  if (ch === "'" || ch === '"') return blankQuoted(code, index);
  return undefined;
}

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
 * Count a declaration's parameters from its `code` (which starts at the
 * `function` keyword and therefore includes the parameter list).
 *
 * Returns 0 for an empty list. Nested generics/arrays are counted at the top
 * level only, so `array $a, ?Foo $b = null` is 1 rather than counting the comma
 * inside a default value.
 */
/** What a parameter list scan found: the top-level comma count and whether any
 *  non-whitespace sat between the parentheses. */
interface ParamScan {
  commas: number;
  sawContent: boolean;
}

/**
 * Scan from `open` (the `(`) to its matching `)`, counting commas at depth 1.
 *
 * Separated from countParameters so the loop's brace counter is not tangled with
 * the "is this list empty" decision -- together they measured CCN 11.
 */
function scanParamList(stripped: string, open: number): ParamScan {
  let depth = 0;
  let commas = 0;
  let sawContent = false;
  for (let i = open; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ',') {
      commas++;
      continue;
    }
    if (!/\s/.test(ch)) sawContent = true;
  }
  return { commas, sawContent };
}

/**
 * Count a declaration's parameters from its `code` (which starts at the
 * `function` keyword and therefore includes the parameter list).
 *
 * Returns 0 for an empty list. Commas inside a nested default value are not
 * counted, because the scan only tallies at depth 1.
 */
function countParameters(code: string): number {
  const open = code.indexOf('(');
  if (open < 0) return 0;
  const scan = scanParamList(stripPhpLiterals(code), open);
  if (!scan.sawContent) return 0;
  return scan.commas + 1;
}
