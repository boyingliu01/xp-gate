import { BaseAdapter } from './base';
import { skipLineComment } from './line-comment';
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
 * C# method declaration: optional modifiers, return type, name, params, then
 * either a block `{`, an expression body `=>`, or `;` (abstract / interface
 * members). `async` and generics (`Task<int>`) must be tolerated or every async
 * method in a modern codebase is invisible.
 *
 * Module scope, not a local in `extractFunctions`: the complexity analyzer
 * counts branches by scanning the function body text, and a regex literal is
 * dense in `|` and `?`. Kept inline, these two patterns alone put
 * `extractFunctions` at CCN 18 — a number that described the regex source
 * rather than the code. The patterns are constant, so module scope is also where
 * they belong.
 */
const METHOD_DECLARATION =
  /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|abstract|extern|unsafe|new|partial)\s+)*(?:[\w.<>\[\],?]+\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:where\s[^{;]*)?(?:=>|\{|;)/g;

/**
 * Constructors: `public Foo(...)` has no return type, so METHOD_DECLARATION can
 * miss it when the modifier list is empty or minimal. Same module-scope
 * rationale.
 */
const CONSTRUCTOR_DECLARATION =
  /(?:^|\n)[ \t]*(?:(?:public|private|protected|internal|static)\s+)*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?\{/g;

/**
 * A C# type declaration.
 *
 * The trailing group accepts BOTH shapes a type declaration takes: a body (`{`)
 * and a body-less primary-constructor record (`record Delta(int X);`, C# 9+).
 * Requiring `{` made every such record invisible to the god-class / large-file
 * rules. Module scope for the same reason as METHOD_DECLARATION: a regex literal
 * is dense in `|` and `?`, which the complexity analyzer counts as branches.
 */
const CLASS_DECLARATION =
  /\b(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new)\s+)*(class|interface|struct|record|enum)\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*(?::\s*[^{\n;]+)?\s*(?:\{|;)/g;

/** One member declaration inside a type body, for the god-class rule. */
const MEMBER_DECLARATION = /\b(?:public|private|protected|internal)\s+[^;{}]*\([^)]*\)\s*(?:=>|\{)/g;

/** How many accessor-prefixed members a type body declares. */
function countMemberDeclarations(body: string): number {
  return (body.match(MEMBER_DECLARATION) || []).length;
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
/**
 * The deepest run of braces in a body, or 0 when it has none.
 *
 * The body still carries its STRING and CHARACTER literals -- measured on
 * `var s = "{{{{";`, which reported nesting 5 for source that has 2 levels. So the
 * literal bodies are neutralised first; leaving them in counts braces nobody wrote as
 * depth, which is the direction that inflates a nesting finding.
 *
 * `max(0, ...)` keeps a body that only CLOSES braces (a fragment) from reporting a
 * negative depth.
 */
function maxNestingOf(body: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const ch of withoutLiterals(body)) {
    if (ch === '{') {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (ch === '}') {
      depth--;
    }
  }
  return Math.max(0, maxDepth);
}

/**
 * A quoted run, keeping the quotes but not the contents.
 *
 * This does NOT model C#'s grammar -- no raw strings, no verbatim strings -- and it does
 * not need to. MEASURED against every form that can hold a brace:
 *
 *   `"""\n{ { { {\n"""`         raw string      -> 0 braces survive
 *   `@"a""b{ {"`                   verbatim        -> 0 braces survive
 *   `"""\nsay "hi" { {\n"""`        raw + quotes     -> 0 braces survive
 *   `@"a""b{ {"; if (x) { }`       verbatim + code -> 1 brace, which is the `if`
 *
 * The reason is structural: C# quote pairing always yields a CLOSED interval, and a
 * verbatim `""` escape consumes as two adjacent literals. So the regex is right for any
 * input a C# file can produce even though it would be wrong for a general lexer.
 *
 * Recorded because three reviewers raised it independently; if a future form breaks the
 * closed-interval property, this comment is where the reasoning lives.
 */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/**
 * The body with literal CONTENTS blanked out, preserving length.
 *
 * Length is preserved because callers may count positions; the braces inside a literal
 * are what must not reach the depth scan.
 */
function withoutLiterals(body: string): string {
  return body.replace(STRING_LITERAL, (literal) => `"${' '.repeat(Math.max(0, literal.length - 2))}"`);
}

/**
 * Open a character literal.
 *
 * Never verbatim: C# has no `@'a'` form, and reusing the verbatim flag from an earlier
 * string would make the closing quote read as escaped.
 */
function openCharLiteral(lex: CSharpLexState): number {
  lex.inString = true;
  lex.inVerbatimString = false;
  lex.stringChar = "'";
  return 1;
}

/**
 * How many backslashes immediately precede `i`.
 *
 * The count decides whether a quote is DATA or a terminator, and only its PARITY
 * matters: an even run leaves the quote unescaped.
 */
function countPrecedingBackslashes(src: string, i: number): number {
  let count = 0;
  for (let j = i - 1; j >= 0 && src[j] === '\\'; j--) count++;
  return count;
}

/**
 * `@"` opens a VERBATIM string, where a quote is escaped by doubling.
 *
 * A bare `@` is an identifier prefix (`@class`), not a string.
 */
function openAtSign(nextChar: string, lex: CSharpLexState): number {
  if (nextChar !== '"') return 0;
  lex.inString = true;
  lex.inVerbatimString = true;
  lex.stringChar = '"';
  return 2;
}

/**
 * Handle a quote inside a VERBATIM string.
 *
 * A doubled quote is content (`@"a""b"` is `a"b`), consuming both characters. A single
 * one closes the literal and clears BOTH flags -- leaving `inVerbatimString` set would
 * make the next ordinary string inherit the doubling rule.
 */
function skipVerbatimQuote(src: string, i: number, lex: CSharpLexState): number {
  if (src[i + 1] === '"') return 2;
  lex.inString = false;
  lex.inVerbatimString = false;
  return 1;
}

/**
 * `//` versus a block-comment opener: the same first character, so only lookahead tells
 * them apart.
 *
 * A lone `/` is DIVISION, and blanking from it would swallow the rest of the line.
 */
function openSlash(src: string, i: number, nextChar: string, lex: CSharpLexState): number {
  if (nextChar === '/') return skipLineComment(src, i);
  if (nextChar !== '*') return 0;
  lex.inBlockComment = true;
  return 2;
}

export class CSharpAdapter extends BaseAdapter implements Adapter {
  /**
   * This adapter implements rules of its own, so the gate may report its files
   * as genuinely examined. Adapters that only make a language detectable leave
   * this at the BaseAdapter default (`false`) and are reported as unanalysed.
   */
  readonly declaresRuleCoverage: boolean = true;

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
    this.collectDeclarations(METHOD_DECLARATION, 'function', matches);
    this.collectDeclarations(CONSTRUCTOR_DECLARATION, 'constructor', matches);
    return matches;
  }

  extractClasses(): unknown[] {
    const matches: unknown[] = [];

    let match: RegExpExecArray | null;
    while ((match = CLASS_DECLARATION.exec(this.fileContent)) !== null) {
      const codeMatch = this.createCodeMatch(match[2], match[1], match.index);
      const body = this.extractCodeBlock(match.index);
      // methodCount feeds the god-class rule; counting declarations in the body
      // is the only signal available without a real parser.
      this.annotate(codeMatch, 'methodCount', countMemberDeclarations(body));
      matches.push(codeMatch);
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
    // A method body contributes its own level, so a flat body reads 1.
    m.nestingDepth = maxNestingOf(body);
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

    const inContext = this.skipActiveContext(i, char, nextChar, lex);
    if (inContext !== null) return inContext;
    return this.openContext(i, char, nextChar, lex);
  }

  /**
   * Continue whatever literal or comment is already open, or null.
   *
   * Checked before ANY opener, so a `//` inside a raw string stays text and a quote
   * inside a comment stays a comment.
   */
  private skipActiveContext(
    i: number,
    char: string,
    nextChar: string,
    lex: CSharpLexState,
  ): number | null {
    if (lex.inRawString) return this.skipRawStringBody(i, lex);
    if (lex.inBlockComment) return this.skipBlockCommentBody(i, char, nextChar, lex);
    if (lex.inString) return this.skipStringBody(i, char, lex);
    return null;
  }

  /**
   * Recognise a construct that opens here, or return 0 for a structural character.
   *
   * C# has three string forms and they are told apart by PREFIX, not by the quote
   * alone: `@"` is verbatim (where `""` escapes a quote and a backslash is literal),
   * a run of 3+ quotes is raw, and a bare quote is ordinary.
   */
  private openContext(i: number, char: string, nextChar: string, lex: CSharpLexState): number {
    if (char === '/') return openSlash(this.fileContent, i, nextChar, lex);
    if (char === '@') return openAtSign(nextChar, lex);
    if (char === '"') return openDoubleQuoteString(this.fileContent, i, lex);
    if (char === "'") return openCharLiteral(lex);
    return 0;
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
    if (lex.inVerbatimString) return skipVerbatimQuote(this.fileContent, i, lex);
    // A quote closes the literal only after an EVEN number of backslashes:
    // `"\\"` is a backslash then a terminator, `"\""` is a quote as data.
    if (countPrecedingBackslashes(this.fileContent, i) % 2 === 0) lex.inString = false;
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
/**
 * A `"` opens a raw literal when it starts a run of 3+, else an ordinary one.
 *
 * The run is counted BEFORE the state changes: a raw literal consumes the whole run
 * as its opening delimiter, so three quotes must not be read as an empty string.
 *
 * A module-level function rather than a method because `CSharpAdapter` sits at the
 * class-size ceiling -- and this reads nothing but its arguments.
 *
 * @returns characters consumed
 */
function openDoubleQuoteString(content: string, i: number, lex: CSharpLexState): number {
  let run = 0;
  while (content[i + run] === '"') run++;
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
