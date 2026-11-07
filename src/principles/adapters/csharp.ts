import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * Lexical state for the C# block scanner: which comment/quote the scan is
 * currently inside. Braces seen in any of these states are data, not structure.
 *
 * C# needs one more state than C++: verbatim strings (`@"..."`) terminate on a
 * doubled quote rather than a backslash escape, and raw string literals
 * (`"""..."""`) have no escape character at all. Treating either as a normal
 * literal would mis-judge where the body ends.
 */
interface CSharpLexState {
  inString: boolean;
  /** Which quote character opened the string (`'` or `"`). */
  stringChar: string;
  inBlockComment: boolean;
  /** `@"..."`: `""` is an escaped quote, backslash is literal. */
  inVerbatimString: boolean;
  /** `"""..."""`: delimited by a run of >= 3 quotes. */
  inRawString: boolean;
  rawStringQuoteCount: number;
}

/**
 * C# language adapter for the principles checker (Gate 4).
 *
 * Why this file exists: `analyzer.ts`'s `adapterMap` had no `.cs` entry, so
 * `getAdapterForFile('A.cs')` returned `null`. `gate-4.sh` DID pass `.cs` paths
 * to the checker (its extension filter includes `cs`), so the file was accepted
 * and then dropped — a gate that printed "checking" and checked nothing. The
 * AC that claimed Gate 4 covered C# by testing the *filter* alone was therefore
 * wrong, which is what this adapter and its tests fix.
 *
 * Regex-based rather than AST-based, following `cpp.ts`: no C# parser is
 * available in this zero-dependency package, and the same lexical-blindness
 * problem (braces inside literals/comments) applies verbatim.
 */
export class CSharpAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const lower = this.filePath.toLowerCase();
    if (lower.endsWith('.cs') || lower.endsWith('.csx')) {
      return 'csharp';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return this.createParseResult('csharp');
  }

  /**
   * Scan `regex` over the file and record one code match per surviving hit.
   *
   * Methods and constructors are found by two different patterns, but they
   * produce the same shape (name, paramCount, body metrics) and share the
   * reserved-word guard. Keeping the two loops separate duplicated that logic
   * and raised this method's complexity for no benefit.
   */
  private collectDeclarations(
    regex: RegExp,
    kind: 'function' | 'constructor',
    into: unknown[],
  ): void {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(this.fileContent)) !== null) {
      const name = match[1];
      // Constructors and `new` expressions look like the patterns above; the
      // reserved words are not method names as far as the rules care.
      if (CSharpAdapter.RESERVED.has(name)) continue;

      const params = match[2].trim();
      const codeMatch = this.createCodeMatch(name, kind, match.index);
      this.annotate(codeMatch, 'paramCount', params === '' ? 0 : params.split(',').length);
      this.annotateBodyMetrics(codeMatch);
      into.push(codeMatch);
    }
  }

  extractFunctions(): unknown[] {
    const matches: unknown[] = [];

    // C# method declaration: optional modifiers, return type, name, params,
    // then either a block `{`, an expression body `=>`, or `;` (abstract /
    // interface members). `async` and generics (`Task<int>`) must be tolerated
    // or every async method in a modern codebase is invisible.
    this.collectDeclarations(
      /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|abstract|extern|unsafe|new|partial)\s+)*(?:[\w.<>\[\],?]+\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:where\s[^{;]*)?(?:=>|\{|;)/g,
      'function',
      matches,
    );

    // Constructors: `public Foo(...)` has no return type, so the regex above
    // can miss it when the modifier list is empty or minimal.
    this.collectDeclarations(
      /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static)\s+)*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?\{/g,
      'constructor',
      matches,
    );

    return matches;
  }

  extractClasses(): unknown[] {
    const matches: unknown[] = [];
    // The trailing group accepts BOTH shapes a type declaration takes: a body
    // (`{`) and a body-less primary-constructor record (`record Delta(int X);`,
    // C# 9+). Requiring `{` made every such record invisible to the god-class /
    // large-file rules.
    const classRegex =
      /\b(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new)\s+)*(class|interface|struct|record|enum)\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*(?::\s*[^{\n;]+)?\s*(?:\{|;)/g;

    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(this.fileContent)) !== null) {
      matches.push(this.createCodeMatch(match[2], match[1], match.index));
      const body = this.extractCodeBlock(match.index);
      // methodCount feeds the god-class rule; counting declarations in the body
      // is the only signal available without a real parser.
      const methodCount = (body.match(/\b(?:public|private|protected|internal)\s+[^;{}]*\([^)]*\)\s*(?:=>|\{)/g) || []).length;
      this.annotate(matches[matches.length - 1], 'methodCount', methodCount);
    }

    return matches;
  }

  /**
   * Attach a computed metric to a match returned by `createCodeMatch`.
   *
   * The base helper builds `{name, type, line, code}`; the 14 rules read extra
   * fields (length / paramCount / nestingDepth / methodCount / hasTryCatch), and
   * a missing field is why 12 of those rules were structurally unable to fire on
   * TypeScript before #446. This keeps the same lesson from repeating here.
   */
  private annotate(target: unknown, key: string, value: number): void {
    (target as Record<string, unknown>)[key] = value;
  }

  /**
   * Compute the body-derived metrics the rules read, from this match's own
   * `code` (which `createCodeMatch` already cut with the literal-aware scanner).
   *
   * length / nestingDepth / hasTryCatch all come from the body, so computing
   * them anywhere else would re-implement the brace scan and drift from it.
   */
  private annotateBodyMetrics(target: unknown): void {
    const m = target as Record<string, unknown>;
    const body = typeof m.code === 'string' ? m.code : '';

    // Lines of the body, minus the declaration line itself.
    const lineCount = body === '' ? 0 : body.split(/\r?\n/).length;
    m.length = lineCount;

    // Nesting depth = the deepest run of `{` that the scanner saw. Literals and
    // comments were already removed by the scanner before this string was cut.
    let depth = 0;
    let maxDepth = 0;
    for (const ch of body) {
      if (ch === '{') { depth++; if (depth > maxDepth) maxDepth = depth; }
      else if (ch === '}') depth--;
    }
    // A method body contributes its own level, so a flat body reads 1.
    m.nestingDepth = maxDepth > 0 ? maxDepth : 0;

    m.hasTryCatch = /\btry\s*\{/.test(body) && /\bcatch\s*[({]/.test(body);
  }

  /** Words that the C# grammar allows where a method name appears. */
  private static readonly RESERVED = new Set([
    'if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return',
    'new', 'throw', 'case', 'do', 'else', 'fixed', 'try', 'finally', 'yield',
    'await', 'typeof', 'sizeof', 'nameof', 'default', 'checked', 'unchecked',
  ]);

  override extractCodeBlock(startPos: number, maxFallback: number = 200): string {
    const state = { inBlock: false, braceCount: 0 };
    const lex: CSharpLexState = {
      inString: false,
      stringChar: '',
      inBlockComment: false,
      inVerbatimString: false,
      inRawString: false,
      rawStringQuoteCount: 0,
    };
    let endPos = startPos;

    for (let i = startPos; i < this.fileContent.length;) {
      const skip = this.lexSkip(i, lex);
      if (skip > 0) { i += skip; continue; }

      const result = this.advanceBraceTracker(this.fileContent[i], i, state);
      if (result.closed) {
        endPos = result.endPos;
        break;
      }
      i++;
    }

    if (endPos > startPos) {
      return this.fileContent.substring(startPos, endPos);
    }

    return this.fallbackCodeBlock(startPos, maxFallback);
  }

  /**
   * Report how far the lexer can skip from `i`, updating `lex` as it goes.
   *
   * Same contract as `cpp.ts`'s `lexSkip`: returning 0 means the caller must
   * inspect the character itself, which is what lets a `{` both end a
   * literal-free run and open the block.
   */
  private lexSkip(i: number, lex: CSharpLexState): number {
    const char = this.fileContent[i];
    const nextChar = this.fileContent[i + 1] || '';

    if (lex.inRawString) return this.skipRawStringBody(i, lex);
    if (lex.inBlockComment) return this.skipBlockCommentBody(i, char, nextChar, lex);
    if (lex.inString) return this.skipStringBody(i, char, lex);

    if (char === '/' && nextChar === '/') return this.skipLineComment(i);
    if (char === '/' && nextChar === '*') {
      lex.inBlockComment = true;
      return 2;
    }

    // `@"` opens a verbatim string; `"` alone opens a normal one.
    if (char === '@' && nextChar === '"') {
      lex.inString = true;
      lex.inVerbatimString = true;
      lex.stringChar = '"';
      return 2;
    }

    // A run of 3+ quotes is a raw string literal.
    if (char === '"') {
      let run = 0;
      let k = i;
      while (this.fileContent[k] === '"') { run++; k++; }
      if (run >= 3) {
        lex.inRawString = true;
        lex.rawStringQuoteCount = run;
        return run;
      }
      lex.inString = true;
      lex.inVerbatimString = false;
      lex.stringChar = '"';
      return 1;
    }

    if (char === "'") {
      lex.inString = true;
      lex.inVerbatimString = false;
      lex.stringChar = "'";
      return 1;
    }

    return 0;
  }

  /** Skip a `//` comment through, but not including, the newline. */
  private skipLineComment(start: number): number {
    let i = start;
    while (i < this.fileContent.length && this.fileContent[i] !== '\n') i++;
    return i - start;
  }

  private skipBlockCommentBody(
    i: number,
    char: string,
    nextChar: string,
    lex: CSharpLexState,
  ): number {
    if (char === '*' && nextChar === '/') {
      lex.inBlockComment = false;
      return 2;
    }
    return 1;
  }

  private skipStringBody(i: number, char: string, lex: CSharpLexState): number {
    if (char !== lex.stringChar) return 1;

    // Verbatim strings escape a quote by DOUBLING it: `@"a""b"` is `a"b`.
    if (lex.inVerbatimString) {
      if (this.fileContent[i + 1] === '"') return 2;
      lex.inString = false;
      lex.inVerbatimString = false;
      return 1;
    }

    // A quote closes the literal only after an EVEN number of backslashes:
    // `"\\"` is a backslash then a terminator, `"\""` is a quote as data.
    let backslashCount = 0;
    let j = i - 1;
    while (j >= 0 && this.fileContent[j] === '\\') {
      backslashCount++;
      j--;
    }
    if (backslashCount % 2 === 0) lex.inString = false;
    return 1;
  }

  /** A raw string closes on a quote run of the same length that opened it. */
  private skipRawStringBody(i: number, lex: CSharpLexState): number {
    if (this.fileContent[i] !== '"') return 1;

    let run = 0;
    let k = i;
    while (this.fileContent[k] === '"') { run++; k++; }

    if (run >= lex.rawStringQuoteCount) {
      lex.inRawString = false;
      lex.rawStringQuoteCount = 0;
      return run;
    }
    return run;
  }
}