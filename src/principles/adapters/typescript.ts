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

const IO_CALLEE_RE = new RegExp(`\\b(?:${IO_CALLEES.join('|')})\\s*\\(`, 'g');
const IO_GLOBAL_RE = new RegExp(`(?:^|[^.\\w$])(?:${IO_GLOBAL_CALLEES.join('|')})\\s*\\(`, 'gm');

/** Keywords that look like `name(` but are control flow, not callables. */
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete',
  'void', 'in', 'instanceof', 'do', 'else', 'try', 'finally', 'throw', 'await',
  'yield', 'function', 'class', 'super', 'this', 'import', 'export', 'default',
  'case', 'break', 'continue', 'const', 'let', 'var', 'as', 'satisfies', 'keyof',
]);

/**
 * Find the index of the `{` that opens a declaration body for the parameter
 * list starting at `parenIndex`.
 *
 * Everything between the closing `)` and the body is scanned with a small depth
 * tracker so that a `{` belonging to a type literal in the return annotation
 * (`extract(): Array<{value: number}> {`) is not mistaken for the body. The
 * body brace is the first `{` seen at depth 0.
 */
function findBodyBrace(masked: string, parenIndex: number): number {
  if (masked[parenIndex] !== '(') return -1;
  const { end } = readParenGroup(masked, parenIndex);
  let depth = 0;
  for (let i = end; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') { const g = readParenGroup(masked, i); i = g.end - 1; continue; }
    if (c === '<' || c === '[') { depth++; continue; }
    if (c === '>' || c === ']') { if (depth > 0) depth--; continue; }
    if (c === '{') {
      if (depth === 0) return i;
      depth++;
      continue;
    }
    if (c === '}') { if (depth > 0) depth--; continue; }
    if (c === ';' || c === '\n') {
      // A line break before any `{` means this header has no braced body
      // (e.g. an interface member or an overload signature).
      if (depth === 0) return -1;
    }
  }
  return -1;
}

/** Index just past the matching `}` for the block opened at `open`. */
function findBlockEnd(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return masked.length;
}

/**
 * Body brace for declarations that have no parameter list (`class`, `interface`).
 * Scans forward from the end of the declaration header; the first `{` at generic
 * depth 0 is the body. A `;` before any brace means there is no body.
 */
function findDeclarationBrace(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === '<' || c === '[' || c === '(') {
      if (c === '(') { const g = readParenGroup(masked, i); i = g.end - 1; continue; }
      depth++;
      continue;
    }
    if (c === '>' || c === ']') { if (depth > 0) depth--; continue; }
    if (c === '{') {
      if (depth === 0) return i;
      depth++;
      continue;
    }
    if (c === '}') { if (depth > 0) depth--; continue; }
    if (c === ';' && depth === 0) return -1;
    // Stop at a blank line / a new top-level keyword so we do not run into the
    // next declaration when this one has no body.
    if (c === '\n') {
      const rest = masked.substring(i + 1).replace(/^[ \t]*/, '');
      if (/^(?:export|import|interface|class|const|let|var|function|type|declare|@)/.test(rest) && depth === 0) {
        return -1;
      }
    }
  }
  return -1;
}

function lineOf(src: string, index: number): number {
  return src.substring(0, index).split('\n').length;
}

/** Count top-level, comma-separated parameters in a raw parameter list. */
function countParams(rawList: string): number {
  const trimmed = rawList.trim();
  if (trimmed === '') return 0;
  let depth = 0;
  let count = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inSingle) { if (c === '\\') i++; else if (c === "'") inSingle = false; continue; }
    if (inDouble) { if (c === '\\') i++; else if (c === '"') inDouble = false; continue; }
    if (inTemplate) { if (c === '\\') i++; else if (c === '`') inTemplate = false; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    else if (c === ',' && depth === 0) count++;
  }
  return count;
}

/**
 * Extract the balanced `( ... )` group that starts at `open`.
 * Returns the inner text and the index just past the closing paren.
 */
function readParenGroup(src: string, open: number): { inner: string; end: number } {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inSingle) { if (c === '\\') i++; else if (c === "'") inSingle = false; continue; }
    if (inDouble) { if (c === '\\') i++; else if (c === '"') inDouble = false; continue; }
    if (inTemplate) { if (c === '\\') i++; else if (c === '`') inTemplate = false; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { inner: src.substring(open + 1, i), end: i + 1 };
    }
  }
  return { inner: src.substring(open + 1), end: src.length };
}

/** Max brace nesting depth inside a function body (1 = body itself). */
function maxNesting(body: string): number {
  let depth = 0;
  let max = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const next = body[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inSingle) { if (c === '\\') i++; else if (c === "'") inSingle = false; continue; }
    if (inDouble) { if (c === '\\') i++; else if (c === '"') inDouble = false; continue; }
    if (inTemplate) { if (c === '\\') i++; else if (c === '`') inTemplate = false; continue; }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '{') { depth++; if (depth > max) max = depth; }
    else if (c === '}') depth--;
  }
  return max;
}

/** Which IO callees appear in this body. */
function ioOperationsIn(body: string): string[] {
  const found = new Set<string>();
  IO_CALLEE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IO_CALLEE_RE.exec(body)) !== null) {
    found.add(m[0].replace(/\s*\($/, ''));
  }
  IO_GLOBAL_RE.lastIndex = 0;
  while ((m = IO_GLOBAL_RE.exec(body)) !== null) {
    const name = /(\w+)\s*\($/.exec(m[0].trim());
    if (name) found.add(name[1]);
  }
  return [...found];
}

/**
 * Blank out comments and string/template literals, preserving offsets.
 * A single left-to-right scan is used rather than chained `.replace()` calls:
 * sequential regex replacement re-scans text that earlier passes produced and
 * can pair a quote inside a regex literal with a quote in a later comment,
 * swallowing hundreds of lines (observed as a 302-line phantom function).
 */
function maskLiterals(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && next === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = ' '; i++; }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }

    // Regex literals: `/.../flags`. Only treat `/` as a regex start when the
    // previous significant character cannot end an expression.
    if (c === '/') {
      const before = src.substring(0, i).replace(/\s+$/, '');
      const prev = before[before.length - 1];
      const prevWord = /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|instanceof)$/.test(before);
      if (prev === undefined || /[=(,:[!&|?{};+\-*%^~<>]/.test(prev) || prevWord) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < src.length) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) {
          for (let k = i; k <= j; k++) out[k] = ' ';
          i = j + 1;
          while (i < src.length && /[a-z]/i.test(src[i])) { out[i] = ' '; i++; }
          continue;
        }
      }
    }

    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out[i] = ' ';
      i++;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { out[i] = ' '; if (i + 1 < src.length) out[i + 1] = ' '; i += 2; continue; }
        if (d === quote) { out[i] = ' '; i++; break; }
        if (d === '\n' && quote !== '`') break;
        out[i] = ' ';
        i++;
      }
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

  /**
   * Numeric literals for the magic-numbers rule, which reads
   * `adapter.extract()` -> `[{value, line}]`. Numbers inside comments and
   * string/template literals are skipped via maskLiterals().
   */
  extract(): Array<{ value: number; line: number }> {
    const src = this.fileContent;
    const results: Array<{ value: number; line: number }> = [];
    const masked = maskLiterals(src);

    const numRe = /(?<![\w$.])(\d+(?:\.\d+)?)(?![\w$])/g;
    let m: RegExpExecArray | null;
    while ((m = numRe.exec(masked)) !== null) {
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
    const masked = maskLiterals(src);
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
    const masked = maskLiterals(src);
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
    const src = this.fileContent;
    // Match declarations against the masked source so identifiers that appear
    // only in comments or strings are never mistaken for functions, while
    // bodies/positions still come from the original text (same offsets).
    const masked = maskLiterals(src);
    const found: FunctionMetrics[] = [];
    const seen = new Set<string>();

    // 1. `function name(...)` declarations (incl. export / async / generators).
    const declRe = /(?:^|[^\w$.])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*/g;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(masked)) !== null) {
      const nameIndex = m.index + m[0].length - m[1].length;
      const parenIndex = masked.indexOf('(', declRe.lastIndex - 1);
      if (parenIndex === -1) continue;
      const bodyOpen = findBodyBrace(masked, parenIndex);
      if (bodyOpen === -1) continue;
      const key = `${m[1]}@${nameIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(this.buildFunction(m[1], 'function', nameIndex, parenIndex, bodyOpen));
    }

    // 2. Class methods: `name(...) {`. Not anchored to line start so minified
    //    single-line bodies count too. Control-flow keywords are excluded -- a
    //    bare `if (a > 0) {` matches the shape but is not a method.
    const memberRe = /(?<![\w$.])(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+|\*\s*)*(\w+)\s*\(/g;
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
      const key = `${m[1]}@${nameIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(this.buildFunction(m[1], 'method', nameIndex, parenIndex, bodyOpen));
    }

    // 3. Arrow consts / assignments: `const name = (...) =>` / `name = x =>`.
    const arrowRe = /(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?/g;
    while ((m = arrowRe.exec(masked)) !== null) {
      const rest = masked.substring(arrowRe.lastIndex);
      const parenOffset = /^\s*\(/.test(rest) ? rest.indexOf('(') : -1;
      let parenIndex: number;
      if (parenOffset !== -1) {
        parenIndex = arrowRe.lastIndex + parenOffset;
      } else {
        // Single-identifier param: `x => ...`
        const simple = /^\s*(\w+)\s*=>/.exec(rest);
        if (!simple) continue;
        parenIndex = -1;
      }
      const afterParams = parenIndex === -1
        ? arrowRe.lastIndex + (/^\s*(\w+)/.exec(rest) as RegExpExecArray)[0].length
        : readParenGroup(src, parenIndex).end;
      if (!/^\s*(?::[^=]+)?=>/.test(masked.substring(afterParams))) continue;

      const nameIndex = m.index + m[0].length - m[1].length;
      const braceAfter = masked.indexOf('{', afterParams);
      const arrowBodyStart = braceAfter !== -1 && /^\s*(?::[^=]+)?=>\s*\{/.test(masked.substring(afterParams, braceAfter + 1))
        ? braceAfter
        : -1;

      let length = 1;
      let nestingDepth = 0;
      let hasTryCatch = false;
      let ioOperations: string[] = [];
      let code = '';
      if (arrowBodyStart !== -1) {
        const bodyEnd = findBlockEnd(masked, arrowBodyStart);
        code = src.substring(arrowBodyStart, bodyEnd);
        const startLine = lineOf(src, nameIndex);
        const endLine = lineOf(src, bodyEnd);
        length = Math.max(1, endLine - startLine + 1);
        nestingDepth = maxNesting(code);
        hasTryCatch = /\btry\s*\{/.test(code);
        ioOperations = ioOperationsIn(code);
      }

      const startLine = lineOf(src, nameIndex);
      const key = `${m[1]}@${nameIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        name: m[1],
        type: 'arrow',
        line: startLine,
        startLine,
        endLine: startLine,
        length,
        paramCount: parenIndex === -1 ? 1 : countParams(readParenGroup(src, parenIndex).inner),
        nestingDepth,
        hasTryCatch,
        ioOperations,
        code,
      });
    }

    return found;
  }

  extractClasses(): unknown[] {
    const src = this.fileContent;
    const classRe = /(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    const results: Array<Record<string, unknown>> = [];
    const masked = maskLiterals(src);
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

    const reExportRegex = /^export\s*{/gm;
    let reMatch;
    while ((reMatch = reExportRegex.exec(this.fileContent)) !== null) {
      exportMatches.push({
        name: reMatch[0],
        type: 're-export',
        line: this.getLineNumber(reMatch.index)
      });
    }

    return exportMatches;
  }
}
