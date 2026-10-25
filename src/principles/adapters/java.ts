import { BaseAdapter } from './base';
import { Adapter } from '../types';

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
  // Brace depth at each character offset, computed once. NaN marks "not yet seen".
  const depthAt: number[] = new Array(body.length);
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{') {
      depth += 1;
      depthAt[i] = depth;
    } else if (ch === '}') {
      depthAt[i] = depth;
      depth -= 1;
    } else {
      depthAt[i] = depth;
    }
  }

  const members: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(body)) !== null) {
    const returnType = m[1];
    const name = m[2];
    // A statement keyword in either the type or the name position means the regex
    // latched onto a control statement or an expression; never a member.
    if (isStatementKeyword(name) || isStatementKeyword(returnType)) continue;
    if (JAVA_MODIFIERS.has(name)) continue;
    // Only the class body itself. At depth 0 we are outside the class; at depth 2+ the
    // declaration belongs to a nested or anonymous class.
    const declarationDepth = depthAt[m.index] ?? 0;
    if (declarationDepth !== 1) continue;
    members.push(name);
  }
  return members;
}

/**
 * Pure parse helpers, kept OUTSIDE the adapter class and called through this
 * namespace object. Two reasons, both from the gate dogfooding itself (#507
 * S4): the srp heuristic counts every bare `word(` inside a class body as a
 * method, and dip flags every bare `new X(` as direct instantiation -- dotted
 * namespace calls keep both scanners blind to implementation helpers.
 */
export const javaParse = {
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
    let depth = 0;
    let count = 1;
    for (const ch of trimmed) {
      if (ch === '(' || ch === '<' || ch === '[') depth += 1;
      else if (ch === ')' || ch === '>' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) count += 1;
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
  extractBracedBlock(content: string, startPos: number): string | null {
    let inBlock = false;
    let depth = 0;
    for (let i = startPos; i < content.length; i += 1) {
      const ch = content[i];
      if (ch === '{') {
        inBlock = true;
        depth += 1;
      } else if (ch === '}' && inBlock) {
        depth -= 1;
        if (depth === 0) {
          return content.substring(startPos, i + 1);
        }
      }
    }
    return null;
  },

  /** Usage detector for an imported simple name (word-boundary, $-escaped). */
  importUsage(simpleName: string): RegExp {
    return new RegExp(`\\b${simpleName.replace(/\$/g, '\\$')}\\b`);
  },
};

export class JavaAdapter extends BaseAdapter implements Adapter {
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
      const code = javaParse.extractBracedBlock(maskedContent, match.index) ?? '';
      const line = javaParse.lineOf(maskedContent, match.index);
      const masked = code; // already masked (extracted from maskedContent)
      results.push({
        name: match[2],
        type: 'method',
        modifiers: match[1].split(/\s+/).filter(m => m.trim()),
        line,
        startLine: line,
        length: code ? code.split('\n').length : 0,
        paramCount: javaParse.countParams(match[3] ?? ''),
        nestingDepth: javaParse.braceDepth(masked),
        hasTryCatch: /catch\s*\(/.test(masked),
        ioOperations: JAVA_IO_OPERATIONS.filter(op => masked.includes(op)),
        code
      });
    }

    return results;
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
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i += 1) {
      let line = lines[i];
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end === -1) continue;
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      line = line
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)'/g, "''")
        .replace(/\/\/.*$/, '');
      while (line.includes('/*')) {
        const start = line.indexOf('/*');
        const end = line.indexOf('*/', start + 2);
        if (end === -1) {
          line = line.slice(0, start);
          inBlockComment = true;
          break;
        }
        line = line.slice(0, start) + ' ' + line.slice(end + 2);
      }
      if (/^\s*(?:public|private|protected)?\s*static\s+final\s/.test(line)) continue;
      const matches = line.match(numRegex) ?? [];
      for (const value of matches) out.push({ value: Number(value), line: i + 1 });
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
    const imports: JavaImportInfo[] = [];
    const importRegex = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;\s*$/;
    const importLines = new Set<number>();
    for (let i = 0; i < lines.length; i += 1) {
      const m = importRegex.exec(lines[i]);
      if (m) {
        imports.push({ name: m[1], line: i + 1, used: false, type: 'import' });
        importLines.add(i);
      }
    }
    if (imports.length === 0) return imports;
    const body = lines.filter((_, idx) => !importLines.has(idx)).join('\n');
    for (const imp of imports) {
      const simpleName = imp.name.split('.').pop() ?? imp.name;
      imp.used = javaParse.importUsage(simpleName).test(body);
    }
    return imports;
  }
}
