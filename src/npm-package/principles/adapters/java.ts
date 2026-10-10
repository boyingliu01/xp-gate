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
   * Method-like members inside a class/interface body: `name(` occurrences
   * minus control keywords and constructor calls. Mirrors the TypeScript
   * adapter's member heuristic so SRP/god-class see the same signal shape.
   */
  countMembers(body: string): string[] {
    const memberRe = /(?<![\w$.])(\w+)\s*\(/g;
    const methods: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = memberRe.exec(body)) !== null) {
      const name = m[1];
      if (!MEMBER_KEYWORDS.has(name) && !methods.includes(name)) methods.push(name);
    }
    return methods;
  },

  magicNumberRegex(): RegExp {
    return new RegExp(MAGIC_NUMBER_SOURCE, 'g');
  },

  /**
   * Strip string/char literals and comments (line + block, multi-line)
   * before any brace/call-site analysis. Contents become empty/space so the
   * line structure (and thus length/line numbers) is preserved. This is what
   * keeps a `"{` inside a format string or a javadoc code example from
   * corrupting nestingDepth/hasTryCatch/methodCount (#507 blind review M3/M4).
   */
  maskCode(body: string): string {
    return body
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)'/g, "''")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '');
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
    let match;

    while ((match = methodRegex.exec(this.fileContent)) !== null) {
      const code = this.extractCodeBlock(match.index) ?? '';
      const line = this.getLineNumber(match.index);
      // Brace/catch/IO analysis runs on the MASKED body: an unbalanced `{"`
      // inside a format string or a javadoc example otherwise corrupts
      // nestingDepth/hasTryCatch and bleeds into the next method -- #507 M4.
      const masked = javaParse.maskCode(code);
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

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      const code = this.extractCodeBlock(match.index) ?? '';
      // srp reads `cls.methodCount` directly, with no code re-scan fallback,
      // so an adapter omitting it makes SRP structurally dead on Java -- #507 S4.
      const methods = javaParse.countMembers(javaParse.maskCode(code));
      classMatches.push({
        name: match[3],
        type: 'class',
        modifiers: [match[1], match[2]].filter(m => m && m.trim()),
        line: this.getLineNumber(match.index),
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

    while ((match = ifaceRegex.exec(this.fileContent)) !== null) {
      const code = this.extractCodeBlock(match.index) ?? '';
      const methods = javaParse.countMembers(javaParse.maskCode(code));
      results.push({
        name: match[1],
        line: this.getLineNumber(match.index),
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
