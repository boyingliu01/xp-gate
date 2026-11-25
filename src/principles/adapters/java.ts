import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * Depth change per nesting delimiter in a Java parameter list.
 *
 * Angular and square brackets nest exactly like parentheses here: the only thing
 * that matters is whether a comma sits at depth 0, because that is the only
 * place it separates parameters.
 */
const PARAM_NESTING: Record<string, number> = {
  '(': 1, ')': -1,
  '<': 1, '>': -1,
  '[': 1, ']': -1,
};

/**
 * Structural fields the clean-code rules consume (mirror of the TypeScript
 * adapter's function shape). Before #507 this adapter returned only
 * `{ name, type, modifiers, line, code }`, so every rule reading
 * `startLine`/`length`/`paramCount`/`nestingDepth`/`hasTryCatch`/`ioOperations`
 * silently saw `undefined` and skipped the file -- G4 reported a run over Java
 * with zero effective coverage (#507 S4 audit).
 */
interface JavaFunctionInfo {
  name: string;
  type: string;
  modifiers: string[];
  line: number;
  startLine: number;
  /** Body line span, matching the `length` field long-function reads. */
  length: number;
  paramCount: number;
  nestingDepth: number;
  hasTryCatch: boolean;
  ioOperations: string[];
  code: string;
}

interface JavaImportInfo {
  name: string;
  line: number;
  used: boolean;
  type: string;
}

/** Java-side I/O markers for the missing-error-handling rule. */
const JAVA_IO_OPERATIONS = [
  'executeQuery',
  'executeUpdate',
  'executeBatch',
  'getConnection',
  'FileInputStream',
  'FileOutputStream',
  'FileReader',
  'FileWriter',
  'BufferedReader',
  'BufferedWriter',
  'Files.',
  'HttpClient',
  'RestTemplate',
  'Socket',
];

/** True for a token that carries text, used to drop the empty slots of a split. */
function isNonBlank(token: string): boolean {
  return token.trim().length > 0;
}

/** True when `code` mentions this I/O operation. */
function mentionsIoOperation(code: string, operation: string): boolean {
  return code.includes(operation);
}

/**
 * The I/O operations a method body mentions, in declaration order.
 *
 * A plain loop rather than `JAVA_IO_OPERATIONS.filter(...)`: the ratchet scores
 * the arrow callback as its own anonymous function, and it was the last one
 * above the CCN-10 threshold in this adapter.
 */
function ioOperationsIn(code: string): string[] {
  const found: string[] = [];
  for (const operation of JAVA_IO_OPERATIONS) {
    if (mentionsIoOperation(code, operation)) found.push(operation);
  }
  return found;
}

/**
 * Numeric literal scan for the magic-numbers rule. Lookahead mirrors the
 * TypeScript adapter (`(?![\w$])`): digits as call arguments (`foo(2)`) are
 * the most common magic-number site and must be reported, so `)` is NOT
 * excluded. A per-call regex comes from `javaParse.magicNumberRegex()`;
 * `String.prototype.match` with the global flag returns all matches per line
 * and ignores lastIndex, so there is no shared-state bug to worry about.
 * Known gaps (documented in docs/java-principles-coverage.md): hex
 * (0xFF), underscore separators (1_000) and literal suffixes (1000L) are
 * not matched.
 */
const MAGIC_NUMBER_SOURCE = '(?<![\\w$.])(-?\\d+(?:\\.\\d+)?)(?![\\w$])';

const MEMBER_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'synchronized', 'new',
  'super', 'this', 'throw', 'assert', 'try'
]);

/** Java modifiers that may precede a member declaration, in any order. */
const JAVA_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized',
  'native', 'default', 'strictfp', 'transient', 'volatile', 'sealed', 'non'
]);

/**
 * One Java method or constructor declaration, as a whole line.
 *
 * #587: the old matcher was `(?<![\w$.])(\w+)\s*\(`, i.e. "an identifier followed by an
 * open paren" — which in Java is overwhelmingly a CALL SITE. Every
 * `builder.append(x)`, `Objects.requireNonNull(o)` and `new SQLException(...)` became a
 * phantom member. The reporter measured `WhaleAuditFilter` at 127 against 42 real
 * methods, and a normal 24-method class at 41. `clean-code.god-class` and `solid.srp`
 * both threshold at 30, so on Java they stopped discriminating — a class had to be
 * genuinely enormous before it out-shouted the noise.
 *
 * The discriminator is the LINE shape: a declaration starts at line start (after
 * optional modifiers, annotations, generics and a return type), and its parameter list
 * is followed by `{` (method) or `;` (abstract/interface method). A call site is
 * followed by `.` or `;` or an operator, and is indented inside a body rather than
 * opening a new one.
 *
 * Groups: 1 = name, 2 = the terminator (`{` or `;`).
 */
const JAVA_MEMBER_DECL_SOURCE = [
  // Line start, then any annotations on the same line (`@Override public void run()`).
  '^[ \\t]*',
  '(?:@[\\w$.]+(?:\\([^)]*\\))?[ \\t]*)*',
  // Modifiers, including `non-sealed`.
  '(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|sealed|non-sealed)[ \\t]+)*',
  // Optional generic type parameters: `<T extends Comparable<T>>`.
  '(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>[ \\t]+)?',
  // Return type, or a constructor name with no return type. Allows generics
  // (`Map<String, List<Item>>`), arrays (`byte[]`) and qualified names.
  '([\\w$][\\w$.]*(?:[ \\t]*<[^<>]*(?:<[^<>]*>[^<>]*)*>[ \\t]*)?(?:\\[\\][ \\t]*)*)',
  '[ \\t]+',
  // The name immediately before the parameter list.
  '(\\w+)[ \\t]*\\(',
  // Parameter list: no `;` and no `=` at depth 0 (a `=` means an initializer, i.e. a
  // field or a lambda, not a declaration header). Newlines ARE allowed here — a real
  // declaration wraps its parameters across lines, and a matcher that stopped at the
  // first newline silently dropped every wrapped method (`doFilter` in the #587
  // fixture wraps, and losing it would under-count exactly the long methods that watch
  // out for god classes).
  '[^;{}=]*',
  '\\)',
  // Optional throws clause. `\s` rather than `[ \t]` because a real declaration wraps
  // `throws` onto its own line — a space-only class here dropped `doFilter`, the
  // long-method case a god-class check most needs to see.
  '(?:\\s*throws[^{;]+)?',
  '\\s*([{;])',
].join('');

/**
 * Is this line-initial token sequence a member declaration rather than a control
 * statement that happens to start at line start (`if (x) {`)?
 *
 * `MEMBER_KEYWORDS` covers the statement keywords; constructors and methods are decided
 * by the regex shape. Kept as a function so the two callers share one answer.
 */
function isStatementKeyword(name: string): boolean {
  return MEMBER_KEYWORDS.has(name);
}

/**
 * Parse method declarations out of a masked class or interface body.
 *
 * Returns one entry per DECLARATION — overloads are distinct members, because a class
 * with three `find` overloads is doing three things and is exactly the case
 * god-class/SRP should see. (The old code deduplicated by name, which both hid overload
 * growth and let a single phantom name survive.)
 *
 * **Depth matters as much as line shape.** A class body contains nested and anonymous
 * classes, and their methods are not the outer class's members. Measuring the real
 * `WhaleAuditFilter` this way still produced 53 against 38 real methods, and the extra
 * 15 were exactly the anonymous `ConnectionEventHandler` implementations —
 * `connection_prepareStatement` eight times over. So declarations are only accepted at
 * depth 1, which is the class body itself.
 *
 * @param body masked (comment/string-free) class or interface body, starting at `{`
 * @returns declared member names, including constructors
 */
function parseMemberDeclarations(body: string): string[] {
  const declRe = new RegExp(JAVA_MEMBER_DECL_SOURCE, 'gm');
  const depths = braceDepths(body);

  const members: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(body)) !== null) {
    if (!isMemberDeclaration(m[1], m[2], depths[m.index] ?? 0)) continue;
    members.push(m[2]);
  }
  return members;
}

/**
 * The brace depth at every character offset, computed once.
 *
 * One pass instead of re-scanning the prefix per candidate: a class body of ten members
 * would otherwise be walked ten times.
 *
 * @returns depth[i] is the depth BEFORE the character at `i` is applied, except for `{`
 *   which counts as inside the block it opens
 */
function braceDepths(body: string): number[] {
  const depths: number[] = new Array(body.length);
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{') {
      depth += 1;
      depths[i] = depth;
    } else if (ch === '}') {
      depths[i] = depth;
      depth -= 1;
    } else {
      depths[i] = depth;
    }
  }
  return depths;
}

/**
 * Whether this regex match is a real MEMBER declaration.
 *
 * Three ways it is not, and each is a different false positive:
 *
 *  - a statement keyword in either position means the regex latched onto a control
 *    statement or an expression;
 *  - a modifier is part of the declaration, not a member name;
 *  - only the CLASS BODY itself counts. At depth 0 we are outside the class; at depth 2+
 *    the declaration belongs to a nested or anonymous class, which is not this type's
 *    member list.
 */
function isMemberDeclaration(returnType: string, name: string, depth: number): boolean {
  if (isStatementKeyword(name) || isStatementKeyword(returnType)) return false;
  if (JAVA_MODIFIERS.has(name)) return false;
  return depth === 1;
}

/**
 * Pure parse helpers, kept OUTSIDE the adapter class and called through this
 * namespace object. Two reasons, both from the gate dogfooding itself (#507
 * S4): the srp heuristic counts every bare `word(` inside a class body as a
 * method, and dip flags every bare `new X(` as direct instantiation -- dotted
 * namespace calls keep both scanners blind to implementation helpers.
 */
export /**
 * Whether this character separates two parameters.
 *
 * Only a comma at depth ZERO: `Map<String, List<Integer>>` is one parameter, so the
 * commas inside its arguments must not be counted.
 */
function isSeparator(ch: string, depth: number): boolean {
  return ch === ',' && depth === 0;
}

/** The brace-tracking state one block scan carries. */
interface BraceScan {
  inBlock: boolean;
  depth: number;
}

/**
 * Apply one character to the scan.
 *
 * A `}` before any `{` is ignored rather than taking the depth negative: the scan may
 * START inside a body, and a stray closer would otherwise end the block immediately.
 *
 * @returns whether the block just CLOSED, making `i` its final character
 */
function stepBrace(ch: string, state: BraceScan): boolean {
  if (ch === '{') {
    state.inBlock = true;
    state.depth += 1;
    return false;
  }
  if (ch !== '}' || !state.inBlock) return false;
  state.depth -= 1;
  return state.depth === 0;
}

const javaParse = {
  /** Top-level brace depth of a method body (deep-nesting rule). */
  braceDepth(body: string): number {
    let depth = 0;
    let max = 0;
    for (const ch of body) {
      if (ch === '{') {
        depth += 1;
        if (depth > max) max = depth;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    return max;
  },

  /** Parameter count of a raw parameter list, comma-aware at depth zero. */
  countParams(paramList: string): number {
    const trimmed = paramList.trim();
    if (!trimmed) return 0;
    // Generic and array brackets nest too: `Map<String, List<Integer>>` is ONE
    // parameter, so the commas inside its arguments must not be counted.
    // Which characters change depth and which separate is data, not control
    // flow -- table lookups keep the scan to a single conditional.
    //
    // A comma counts only at depth zero, expressed as ONE condition rather than
    // a nested pair: the earlier form tested `ch === ','` and then re-tested
    // `depth === 0` inside it, which the complexity budget charged twice for a
    // single decision. The `?? 0` default moved into the lookup itself for the
    // same reason -- it was a third branch on a table that answers for every
    // nesting character.
    let depth = 0;
    let count = 1;
    for (const ch of trimmed) {
      if (isSeparator(ch, depth)) count += 1;
      depth += PARAM_NESTING[ch] || 0;
    }
    return count;
  },

  /**
   * Method-like members inside a class/interface body.
   *
   * #587: this counted "identifier followed by `(`", which in Java is a call site, not a
   * declaration — `WhaleAuditFilter` measured 127 against 42 real methods, a normal
   * 24-method class reported 41, and god-class/SRP threshold at 30. Now anchored on
   * declaration shape (see JAVA_MEMBER_DECL_SOURCE). The returned array has one entry
   * per declaration, so overloads count separately.
   */
  countMembers(body: string): string[] {
    return parseMemberDeclarations(body);
  },

  magicNumberRegex(): RegExp {
    return new RegExp(MAGIC_NUMBER_SOURCE, 'g');
  },

  /**
   * Strip string/char literals and comments (line + block, multi-line)
   * before any brace/call-site analysis. Contents become empty/space so the
   * LINE structure (and thus line numbers) is preserved -- column positions
   * shift, so callers must use lineOf() instead of getLineNumber() on masked
   * content. This is what keeps a `"{` inside a format string or a javadoc
   * code example from corrupting nestingDepth/hasTryCatch/methodCount
   * (#507 blind review M3/M4).
   *
   * String/char patterns exclude newlines (#507 Delphi round-1 B-MAJOR-3):
   * a cross-line pairing let one unbalanced quote inside a comment swallow
   * every line up to the NEXT real string, deleting whole control blocks
   * from the analysis. Damage is now bounded to the offending line.
   */
  maskCode(body: string): string {
    return body
      .replace(/"(?:[^"\\\n]|\\[^\n])*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\[^\n])'/g, "''")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '');
  },

  /**
   * Line number of `position` within `content`. maskCode preserves line
   * structure (contents shrink but never add/remove lines), so a line
   * computed on masked content is exact for the original file.
   */
  lineOf(content: string, position: number): number {
    return content.substring(0, position).split('\n').length;
  },

  /**
   * Brace-balanced block starting at the first `{` at/after `startPos`.
   * Runs on MASKED content only -- on raw text a string-embedded `{`
   * desynchronizes the depth tracker. Returns null when unbalanced
   * (callers decide the fallback; base.extractCodeBlock's 100-char
   * truncation fallback would silently hand back garbage structure).
   */
  /**
   * The balanced `{...}` block starting at or after `startPos`, or null.
   *
   * Returned only when the braces BALANCE; an unbalanced tail means the scan ran off
   * the end of the file, and a partial block would be attributed to this member.
   */
  extractBracedBlock(content: string, startPos: number): string | null {
    const state = { inBlock: false, depth: 0 };
    for (let i = startPos; i < content.length; i += 1) {
      if (stepBrace(content[i], state)) return content.substring(startPos, i + 1);
    }
    return null;
  },

  /** Usage detector for an imported simple name (word-boundary, $-escaped). */
  importUsage(simpleName: string): RegExp {
    return new RegExp(`\\b${simpleName.replace(/\$/g, '\\$')}\\b`);
  },
};

/** A whole-line `import` (optionally `static`), capturing the qualified name. */
const JAVA_IMPORT_LINE = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;\s*$/;

/**
 * The file's imports, and the line indexes they occupy.
 *
 * The indexes are returned because the usage scan must look at the body WITHOUT them --
 * an import line contains its own name, which would mark every import as used.
 */
function scanImportLines(lines: string[]): { imports: JavaImportInfo[]; importLines: Set<number> } {
  const imports: JavaImportInfo[] = [];
  const importLines = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    const m = JAVA_IMPORT_LINE.exec(lines[i]);
    if (!m) continue;
    imports.push({ name: m[1], line: i + 1, used: false, type: 'import' });
    importLines.add(i);
  }
  return { imports, importLines };
}

/** Whether a line continues a block comment started on an earlier line. */
interface CommentScan {
  inBlockComment: boolean;
}

/** String literals, whose contents are not code. */
const JAVA_STRING_LITERALS = [
  [/"(?:[^"\\]|\\.)*"/g, '""'],
  [/'(?:[^'\\]|\\.)'/g, "''"],
  [/\/\/.*$/, ''],
] as const;

/** A `static final` declaration: the language's named-constant form. */
const JAVA_CONSTANT_DECL = /^\s*(?:public|private|protected)?\s*static\s+final\s/;

/**
 * Strip strings and comments from one line, or return null when no code remains.
 *
 * Two kinds of state cross lines and both matter: a block comment that opened earlier,
 * and one that opens here and closes later. A literal number inside a comment or a
 * string is not a magic number, so leaving either in would report the file's own prose
 * as debt.
 *
 * @returns the code on this line, or null when the line holds no code at all
 */
function stripJavaComments(rawLine: string, state: CommentScan): string | null {
  let line = rawLine;
  if (state.inBlockComment) {
    const end = line.indexOf('*/');
    if (end === -1) return null;
    line = line.slice(end + 2);
    state.inBlockComment = false;
  }
  for (const [pattern, replacement] of JAVA_STRING_LITERALS) {
    line = line.replace(pattern, replacement);
  }
  return closeInlineComments(line, state);
}

/**
 * Close or open inline block comments, reporting whether the line ran into one.
 *
 * A comment that opens and does not close here switches the state, and the code before
 * it still counts -- so the prefix is returned rather than discarded.
 */
function closeInlineComments(line: string, state: CommentScan): string | null {
  let rest = line;
  while (rest.includes('/*')) {
    const start = rest.indexOf('/*');
    const end = rest.indexOf('*/', start + 2);
    if (end === -1) {
      state.inBlockComment = true;
      return rest.slice(0, start);
    }
    rest = rest.slice(0, start) + ' ' + rest.slice(end + 2);
  }
  return rest;
}

/** Whether this line declares a `static final` constant, whose number is named. */
function isConstantDeclaration(line: string): boolean {
  return JAVA_CONSTANT_DECL.test(line);
}

/** What one magic-number scan carries between lines. */
interface MagicScan {
  numRegex: RegExp;
  state: CommentScan;
  out: Array<{ value: number; line: number }>;
}

/**
 * Collect the magic numbers on one line.
 *
 * Three filters, in order, and each removes a way the file's own prose or its named
 * constants would be reported as debt: strip comments and strings, skip `static final`
 * declarations, then match.
 */
function collectMagicNumbers(rawLine: string, lineNumber: number, scan: MagicScan): void {
  const line = stripJavaComments(rawLine, scan.state);
  if (line === null || isConstantDeclaration(line)) return;
  for (const value of line.match(scan.numRegex) ?? []) {
    scan.out.push({ value: Number(value), line: lineNumber });
  }
}

export class JavaAdapter extends BaseAdapter implements Adapter {
  /**
   * This adapter implements rules of its own, so the gate may report its files
   * as genuinely examined. Adapters that only make a language detectable leave
   * this at the BaseAdapter default (`false`) and are reported as unanalysed.
   */
  readonly declaresRuleCoverage: boolean = true;

  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.java')) {
      return 'java';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'java',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const results: JavaFunctionInfo[] = [];
    const methodRegex = /(public|private|protected|static|final|synchronized|native)\s+[\w<>[\],\s]+?\s+(\w+)\s*\(([^)]*)\)\s*(throws\s+[\w,\s.]+)?\s*\{/g;
    // Signature scan AND block extraction run on the MASKED content
    // (#507 Delphi round-1 B-MAJOR-6 / A-minor-1): a javadoc example like
    // `public int foo(int x) {` on raw text produced a ghost function whose
    // length/nestingDepth fed long-function/deep-nesting, and an unbalanced
    // string brace stretched the extracted block past the real method end.
    // Masked content keeps line structure, so lineOf() is exact.
    const maskedContent = javaParse.maskCode(this.fileContent);
    let match;

    while ((match = methodRegex.exec(maskedContent)) !== null) {
      results.push(this.toFunctionInfo(match, maskedContent));
    }

    return results;
  }

  /**
   * Build one method descriptor from a regex match.
   *
   * Extracted from the `results.push({...})` literal that used to sit in the
   * loop above: the object needed four arrow callbacks (`split`, `filter` for
   * modifiers, and another `filter` for I/O operations), and the ratchet scores
   * each callback as its own anonymous function -- two of them landed above the
   * CCN-10 block threshold inside a method that is itself below it.
   */
  private toFunctionInfo(match: RegExpExecArray, maskedContent: string): JavaFunctionInfo {
    const code = javaParse.extractBracedBlock(maskedContent, match.index) ?? '';
    const line = javaParse.lineOf(maskedContent, match.index);
    return {
      name: match[2],
      type: 'method',
      modifiers: match[1].split(/\s+/).filter(isNonBlank),
      line,
      startLine: line,
      length: code ? code.split('\n').length : 0,
      paramCount: javaParse.countParams(match[3] ?? ''),
      nestingDepth: javaParse.braceDepth(code),
      hasTryCatch: /catch\s*\(/.test(code),
      ioOperations: ioOperationsIn(code),
      code
    };
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    // Generic type parameters -- `class Box<T>`, `class Foo<T> extends Bar<T>` --
    // are the norm in modern Java; without the optional `<...>` slot the
    // whole class vanished from extractClasses and srp/god-class/dip went
    // blind on generic code -- #507 blind review M1.
    const classRegex = /(public|private|protected)?\s*(abstract|final|static)?\s*class\s+(\w+)\s*(?:<[^<>]*>)?\s*(extends\s+[\w.]+(?:<[^<>]*>)?)?\s*(implements\s+[\w,\s.]+(?:<[^<>]*>)?)?\s*\{/g;
    let match;

    // Class scan also runs on masked content: a javadoc mention of `class
    // Foo` no longer yields a ghost class, and string-embedded braces cannot
    // stretch the extracted body (#507 Delphi round-1 B-MAJOR-6).
    const maskedContent = javaParse.maskCode(this.fileContent);
    while ((match = classRegex.exec(maskedContent)) !== null) {
      const code = javaParse.extractBracedBlock(maskedContent, match.index) ?? '';
      // srp reads `cls.methodCount` directly, with no code re-scan fallback,
      // so an adapter omitting it makes SRP structurally dead on Java -- #507 S4.
      const methods = javaParse.countMembers(code);
      classMatches.push({
        name: match[3],
        type: 'class',
        modifiers: [match[1], match[2]].filter(m => m && m.trim()),
        line: javaParse.lineOf(maskedContent, match.index),
        methodCount: methods.length,
        methods,
        code
      });
    }

    return classMatches;
  }

  /**
   * Interfaces for the ISP rule, which reads `adapter.extractInterfaces()`.
   * Java interface methods are bare signature lines, counted with the same
   * member heuristic as classes minus constructors.
   */
  extractInterfaces(): Array<{ name: string; line: number; methods: string[]; methodCount: number; code: string }> {
    const results: Array<{ name: string; line: number; methods: string[]; methodCount: number; code: string }> = [];
    const ifaceRegex = /(?:public|private|protected)?\s*interface\s+(\w+)\s*(?:<[^<>]*>)?\s*\{/g;
    let match;

    // Masked scan, same rationale as extractClasses (#507 Delphi round-1
    // B-MAJOR-6): no ghost interfaces from javadoc, no string-brace bleed.
    const maskedContent = javaParse.maskCode(this.fileContent);
    while ((match = ifaceRegex.exec(maskedContent)) !== null) {
      const code = javaParse.extractBracedBlock(maskedContent, match.index) ?? '';
      const methods = javaParse.countMembers(code);
      results.push({
        name: match[1],
        line: javaParse.lineOf(maskedContent, match.index),
        methods,
        methodCount: methods.length,
        code
      });
    }

    return results;
  }

  /**
   * Numeric literal scan for the magic-numbers rule. Constant declarations
   * (`static final ... = <n>`) are skipped: naming a constant is exactly the
   * remedy the rule asks for. Masking ORDER matters -- #507 blind review M3:
   * string/char literals first, so `"http://x"` cannot swallow the rest of
   * the line as a comment), then line comments, then block comments with
   * cross-line state -- a commented-out code block must not resurrect its
   * numbers as findings.
   */
  extract(): Array<{ value: number; line: number }> {
    const out: Array<{ value: number; line: number }> = [];
    const lines = this.fileContent.split('\n');
    const numRegex = javaParse.magicNumberRegex();
    const state: CommentScan = { inBlockComment: false };
    for (let i = 0; i < lines.length; i += 1) {
      collectMagicNumbers(lines[i], i + 1, { numRegex, state, out });
    }
    return out;
  }

  /**
   * Import statements with a usage signal for the unused-imports rule. Usage
   * is a conservative check: the imported simple name must appear somewhere
   * outside the import block itself.
   */

  get imports(): JavaImportInfo[] {
    const lines = this.fileContent.split('\n');
    const { imports, importLines } = scanImportLines(lines);
    if (imports.length === 0) return imports;
    const body = lines.filter((_, idx) => !importLines.has(idx)).join('\n');
    for (const imp of imports) {
      const simpleName = imp.name.split('.').pop() ?? imp.name;
      imp.used = javaParse.importUsage(simpleName).test(body);
    }
    return imports;
  }
}
