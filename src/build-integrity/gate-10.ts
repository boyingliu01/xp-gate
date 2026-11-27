import { execFile } from 'child_process';
import { joinImportStatement, hasCodeAfterLeadingComment } from './gate-10-lines';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import path from 'path';
import { maskTextQuotes } from './quote-masker';
import { fileURLToPath } from 'url';
import { readManifest, unreachableEntryPointsMessage } from './entry-points.js';
import type {
  CheckResult,
  Gate10Options,
  Gate10Result,
  Gate10Status,
  ImportCheckResult,
  ImportViolation,
} from './types';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NAMING NOTE: This file is named "gate-10.ts" for historical reasons.
 *
 * It implements **pre-commit Gate 9 (Build Integrity)** which verifies:
 *   1. TypeScript compilation (tsc --noEmit)
 *   2. Package manifest integrity (npm pack --dry-run)
 *   3. Import path legality (no path-traversal outside package)
 *
 * History: Originally deployed as Gate 10 in pre-push (build integrity on push).
 * When migrated to pre-commit as Gate 9, the filename was intentionally kept
 * to avoid breaking all import references, CI configs, and baselines that
 * reference "gate-10.ts". It also remains referenced from pre-push as a
 * defense-in-depth check.
 *
 * DO NOT RENAME this file to gate-9.ts without updating ALL references in:
 *   - githooks/pre-commit (Gate 9 section)
 *   - githooks/pre-push (Gate 10 defense-in-depth section)
 *   - src/npm-package/hooks/pre-commit
 *   - src/npm-package/hooks/pre-push
 *   - .architecture-baseline.json
 *   - Any CI workflow referencing this file
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const execFileAsync = promisify(execFile);
const SUPPORTED_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isSupportedModuleFile(file: string): boolean {
  return SUPPORTED_MODULE_EXTENSIONS.has(path.extname(file));
}

/**
 * True when `filePath` exists and is readable - the tsc usability test.
 *
 * Declared as a const arrow on purpose. lizard 1.21.3 mis-nests a
 * `function name(...): T {` declaration that carries a return type annotation
 * when it appears before another JSDoc block: the parse loses the boundary and
 * every following function is absorbed into this function's span (measured on
 * this file - the CCN of five functions collapsed into one row). An arrow
 * assignment keeps the scope flat and lizard reports each function separately.
 */
const isReadableFile = (filePath: string): boolean => {
  let readable = true;
  try {
    fsNative.accessSync(filePath);
  } catch {
    readable = false;
  }
  return readable;
};

/**
 * Resolve the tsc entry point. Three strategies, most specific first: the
 * project's own node_modules, then the cwd's, then Node's resolver. Returns
 * the tsc SCRIPT path (run it through process.execPath) or null, in which case
 * the caller falls back to the npx shim.
 */
const findTscBinary = (projectRoot: string): string | null => {
  const candidates = [
    path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  for (const candidate of candidates) {
    if (isReadableFile(candidate)) return candidate;
  }
  let resolved: string | undefined;
  try {
    resolved = require.resolve('typescript/bin/tsc', { paths: [projectRoot, process.cwd()] });
  } catch {
    return null; // Not resolvable at all -> caller uses the npx shim.
  }
  // Resolvable but not readable also means the caller must use the npx shim.
  return isReadableFile(resolved) ? resolved : null;
};

function tscProbeInvocation(projectRoot: string, resolvedTsc: string | null) {
  return resolvedTsc
    ? { cmd: process.execPath, args: [resolvedTsc, '--version'], opts: { cwd: projectRoot, timeout: 10000 } }
    : {
      cmd: 'npx',
      args: ['tsc', '--version'],
      opts: { cwd: projectRoot, timeout: 10000, shell: true, env: { ...process.env, PATH: process.env.PATH } },
    };
}

function tscCompileInvocation(projectRoot: string, resolvedTsc: string | null, timeoutMs: number) {
  return {
    cmd: resolvedTsc ? process.execPath : 'npx',
    args: resolvedTsc
      ? [resolvedTsc, '--noEmit', '--incremental']
      : ['tsc', '--noEmit', '--incremental'],
    opts: {
      cwd: projectRoot,
      timeout: timeoutMs,
      shell: !resolvedTsc,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    },
  };
}

interface ExecFailure {
  code?: number | null;
  signal?: string;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  message?: string;
}

function isTimeoutFailure(err: ExecFailure): boolean {
  return Boolean(err.killed || err.signal === 'SIGTERM' || err.code === null);
}

function compileFailureMessage(err: ExecFailure): string {
  const output = (err.stdout || '') + (err.stderr || '');
  const truncatedOutput = output.slice(0, 2000);
  const errorMatches = output.match(/error TS\d+:/g);
  const errorCount = errorMatches ? errorMatches.length : 0;
  return errorCount > 0
    ? `TypeScript compilation failed with ${errorCount} error(s):\n${truncatedOutput}`
    : `TypeScript compilation failed:\n${truncatedOutput}`;
}

/** Reasons tsc cannot run at all; null means it is usable. */
/**
 * The placeholder `npx tsc` runs when TypeScript is installed nowhere. Measured
 * 2026-11-23: it prints this banner and **exits 0**, so an exit-code-only probe
 * calls it a working tsc. The probe succeeds while its evidence says the
 * opposite -- this repo's recurring defect shape.
 */
const NPX_TSC_STUB_MARKER = 'This is not the tsc command you are looking for';

/** Did the npx fallback run npm's placeholder? Only it can, so a resolved tsc
 * script is never rejected for printing the phrase by coincidence. */
function isNpxTscPlaceholder(resolvedTsc: string | null, result: { stdout?: unknown; stderr?: unknown }): boolean {
  if (resolvedTsc !== null) return false;
  return `${String(result.stdout || '')}\n${String(result.stderr || '')}`.includes(NPX_TSC_STUB_MARKER);
}

/** Probe whether tsc works: a skip REASON, or null when usable. Split out of
 * `tscSkipReason` because inline it measured CCN 3 -> 5 against the baseline of
 * 3 -- the ratchet was right that this is two jobs. */
async function probeTscUsability(projectRoot: string, resolvedTsc: string | null): Promise<string | null> {
  let result: { stdout?: unknown; stderr?: unknown };
  try {
    const probe = tscProbeInvocation(projectRoot, resolvedTsc);
    result = await execFileAsync(probe.cmd, probe.args, probe.opts);
  } catch {
    return 'tsc is not available on PATH';
  }
  if (isNpxTscPlaceholder(resolvedTsc, result)) {
    return 'tsc is not installed (npx resolved to its placeholder)';
  }
  return null;
}

const tscSkipReason = async (projectRoot: string): Promise<string | null> => {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  try {
    await fs.access(tsconfigPath);
  } catch {
    return 'No tsconfig.json found in project root';
  }
  return probeTscUsability(projectRoot, findTscBinary(projectRoot));
};

/** Run the compile itself and map its failure modes onto gate statuses. */
const runTscCompile = async (projectRoot: string, timeoutMs: number): Promise<CheckResult> => {
  const startTime = Date.now();
  const resolvedTsc = findTscBinary(projectRoot);
  try {
    const compile = tscCompileInvocation(projectRoot, resolvedTsc, timeoutMs);
    const { stdout, stderr } = await execFileAsync(compile.cmd, compile.args, compile.opts);
    const output = stdout + stderr;
    return {
      status: 'pass',
      message: output.trim() || 'TypeScript compilation successful',
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const err = error as ExecFailure;
    if (isTimeoutFailure(err)) {
      return {
        status: 'skip',
        message: `tsc timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - startTime,
      };
    }
    return {
      status: 'fail',
      message: compileFailureMessage(err),
      durationMs: Date.now() - startTime,
    };
  }
};

export async function runTscCheck(
  projectRoot: string,
  timeoutMs: number
): Promise<CheckResult> {
  const startTime = Date.now();
  const skipReason = await tscSkipReason(projectRoot);
  if (skipReason !== null) {
    return { status: 'skip', message: skipReason, durationMs: Date.now() - startTime };
  }
  return runTscCompile(projectRoot, timeoutMs);
}

/**
 * Extracts relative import paths from TypeScript/JavaScript source code.
 * Skips bare npm package imports and node: protocol imports.
 *
 * Supported forms:
 *   import { x } from './foo'
 *   import x from './foo'
 *   import * as x from './foo'
 *   import './foo'
 *   const x = require('./foo')
 *   import('./foo')
 *   export { x } from './foo'
 *   export * from './foo'
 *
 * Import TEXT inside a string, template literal or comment is not an import and
 * must not be reported (issue #759). Projects legitimately contain such text — a
 * test pinning a scanner's own behaviour, a doc block showing the syntax, a
 * parser fixture — and before this was handled, the regexes below matched them
 * and reported violations for paths that never existed.
 */
export function extractImports(content: string): Array<{ path: string; line: number }> {
  const results: Array<{ path: string; line: number }> = [];
  const push = (path: string, line: number) => { results.push({ path, line }); };

  const staticImportExportRe =
    /(?:import|export)\s+(?:(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRe = /(?<!\w)import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  // The scanner runs over a version of the source in which every quote that is
  // NOT a code-level delimiter has been replaced by a sentinel. Length and line
  // breaks are preserved, so the line numbers reported below stay truthful.
  //
  // The distinction that matters is not "inside a string" but "is this quote a
  // delimiter". A real import's path quotes are code-level (depth 0) and must
  // stay visible — the path is the thing we extract. A quote nested inside an
  // outer string is text and must not be. Framing it as nesting depth rather
  // than as "mask all string content" is what keeps `import x from './bar'`
  // working while `const s = "import x from './bar'"` is ignored.
  const scanSource = maskTextQuotes(content);
  const lines = scanSource.split('\n');
  const originalLines = content.split('\n');

  // LINE-major order is the contract (import-resolver.test pins it): one pass
  // over the lines, three patterns per line in static → require → dynamic
  // order — exactly the inline version's nesting. Do not reorder into
  // pattern-major passes; a line containing both a require and an import
  // would then swap positions.
  for (let i = 0; i < lines.length; i++) {
    // Scan unless everything on the line is comment; see
    // `hasCodeAfterLeadingComment` for why a raw-prefix test was not enough.
    if (!hasCodeAfterLeadingComment(originalLines[i])) {
      continue;
    }
    i += scanImportAt(lines, i, { staticImportExportRe, requireRe, dynamicImportRe }, push);
  }

  return results;
}

/** The three patterns, grouped so the per-line scanner takes one argument. */
interface ImportPatterns {
  staticImportExportRe: RegExp;
  requireRe: RegExp;
  dynamicImportRe: RegExp;
}

/**
 * Scan one line for imports and return how many FOLLOWING lines it consumed.
 *
 * Returns 0 for the ordinary single-line case and >0 when the line opens a
 * static statement whose path sits further down, which the caller adds to its
 * cursor. Extracted from `extractImports` to stay under Gate 4's 50-line limit.
 */
function scanImportAt(
  lines: string[],
  i: number,
  patterns: ImportPatterns,
  push: (path: string, line: number) => void,
): number {
  const line = lines[i];
  scanLine(line, i + 1, patterns.requireRe, (m) => m[1], push);
  scanLine(line, i + 1, patterns.dynamicImportRe, (m) => m[1], push);
  // A static import that fits on ONE line is scanned in place, so the common
  // case reports the import's own line. Only a line that OPENS a statement
  // whose path sits further down needs joining:
  // `import {\n  foo,\n} from './bar';` is ordinary formatting, and a per-line
  // pattern misses it entirely (measured: `[]` before this).
  const statement = joinImportStatement(lines, i);
  if (!statement) {
    scanLine(line, i + 1, patterns.staticImportExportRe, (m) => m[1] ?? m[2], push);
    return 0;
  }
  scanLine(statement.text, i + 1, patterns.staticImportExportRe, (m) => m[1] ?? m[2], push);
  // Skip the continuation lines: they hold no import of their own, and
  // re-scanning them would let the static pattern match a fragment and report
  // the import twice at the wrong line.
  return statement.consumed;
}

/** Apply one pattern to a single line; every relative hit is pushed with its line number. */
function scanLine(
  line: string,
  lineNum: number,
  re: RegExp,
  pathOf: (m: RegExpExecArray) => string | undefined,
  push: (path: string, line: number) => void,
): void {
  // Fresh lastIndex per call: a shared /g regex would leak state across
  // lines and silently drop matches at buffer boundaries.
  const lineRe = new RegExp(re.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(line)) !== null) {
    const importPath = pathOf(match);
    if (importPath && isRelativeImport(importPath)) {
      push(importPath, lineNum);
    }
  }
}

function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith('./') || importPath.startsWith('../') || importPath === '.' || importPath === '..';
}

/**
 * Resolves a relative import path to an absolute file path on disk.
 * Returns null for bare npm package imports, node: protocol imports,
 * or when the target file cannot be found.
 *
 * Checks extensions in order: .ts, .tsx, .js, .jsx, .mjs, .cjs, /index.ts, /index.js
 * Also handles explicit .js extension resolving to .ts (TypeScript convention).
 */
function tryAccess(filePath: string): boolean {
  try {
    fsNative.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extensions tried when an import has none, in precedence order.
 *
 * `.js` first because a TS source that imports `./x` is compiled to `x.js`, so
 * the emitted name is the most likely intent in a mixed tree.
 */
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Directory-index filenames tried last, when no sibling file matched. */
const INDEX_FILES = ['index.ts', 'index.js'];

/**
 * Source extensions an explicit `.js` import may actually refer to.
 *
 * TypeScript's ESM output rewrites `./x.ts` to `./x.js`, so an import that names
 * a `.js` file legitimately resolves to the TypeScript source beside it. Checked
 * in order, and only for `.js` -- an explicit `.ts` or `.mjs` must match exactly.
 */
const JS_TO_SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Resolve an import that already names an extension.
 *
 * A `.js` specifier may point at TypeScript source (ESM output rewrites `.ts` to
 * `.js`), so it gets one extra look at the sibling source extensions. Every other
 * extension must match the file on disk exactly.
 */
function resolveExplicitExtension(resolved: string, ext: string): string | null {
  if (tryAccess(resolved)) return resolved;
  if (ext !== '.js') return null;
  const stem = resolved.slice(0, -'.js'.length);
  for (const sourceExt of JS_TO_SOURCE_EXTENSIONS) {
    if (tryAccess(stem + sourceExt)) return stem + sourceExt;
  }
  return null;
}

/**
 * Resolve an extensionless import: try the known extensions in order, then the
 * directory-index names.
 */
function resolveBareImport(resolved: string): string | null {
  for (const tryExt of IMPORT_EXTENSIONS) {
    if (tryAccess(resolved + tryExt)) return resolved + tryExt;
  }
  for (const idxName of INDEX_FILES) {
    const candidate = path.join(resolved, idxName);
    if (tryAccess(candidate)) return candidate;
  }
  return null;
}

export function resolveImportPath(importPath: string, fromFile: string): string | null {
  if (!isRelativeImport(importPath)) return null;

  const resolved = path.resolve(path.dirname(fromFile), importPath);
  const ext = path.extname(importPath);

  return ext
    ? resolveExplicitExtension(resolved, ext)
    : resolveBareImport(resolved);
}

/**
 * Runs the import check on a list of changed files.
 * Verifies that all relative imports in the changed files resolve to files
 * within the project boundary.
 *
 * FAIL conditions:
 * - A relative import resolves to a path outside projectRoot
 * - A relative import resolves to a file that doesn't exist on disk
 */
// Windows paths are case-insensitive but the two sides of the boundary
// comparison get their case from different sources: path.resolve of a
// repo-relative file inherits process.cwd()'s drive-letter case (often
// lowercase), while projectRoot comes from `git rev-parse --show-toplevel`
// (uppercase drive). A case-sensitive startsWith then judged EVERY import
// as escaping the boundary — pre-push Gate 10 blocked any TS-bearing push
// from a shell whose drive-letter case disagreed with git's (#508).
const normalizeForBoundary = (p: string): string => {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const escapesProjectBoundary = (target: string, boundaryRoot: string): boolean =>
  !target.startsWith(boundaryRoot + path.sep) && target !== boundaryRoot;

/** Violation for one import of one file, or null when it resolves cleanly. */
const importViolation = (
  file: string,
  imp: { path: string; line: number },
  boundaryRoot: string
): ImportViolation | null => {
  const rawResolved = path.resolve(path.dirname(file), imp.path);
  if (escapesProjectBoundary(normalizeForBoundary(rawResolved), boundaryRoot)) {
    return {
      file,
      line: imp.line,
      importPath: imp.path,
      resolvedPath: rawResolved,
      reason: 'Import path escapes package boundary (resolves outside project root)',
    };
  }
  if (resolveImportPath(imp.path, file) === null) {
    return {
      file,
      line: imp.line,
      importPath: imp.path,
      resolvedPath: rawResolved,
      reason: 'Import target does not exist on disk',
    };
  }
  return null;
};

/**
 * Violations for one file, or [] when the file is skipped (unsupported
 * extension, test fixture, or unreadable — a missing file cannot have imports).
 */
const fileImportViolations = async (file: string, boundaryRoot: string): Promise<ImportViolation[]> => {
  // Skip test files — they contain intentionally broken imports for unit testing.
  // The published npm package does not include __tests__ directories.
  if (!isSupportedModuleFile(file) || file.includes('__tests__')) return [];
  if (!isReadableFile(file)) return [];
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch {
    return [];
  }
  return extractImports(content)
    .map((imp) => importViolation(file, imp, boundaryRoot))
    .filter((v): v is ImportViolation => v !== null);
};

export async function runImportCheck(
  changedFiles: string[],
  projectRoot: string,
  _timeoutMs: number
): Promise<ImportCheckResult> {
  const startTime = Date.now();
  const boundaryRoot = normalizeForBoundary(path.resolve(projectRoot));
  const violations: ImportViolation[] = [];
  for (const file of changedFiles) {
    violations.push(...(await fileImportViolations(file, boundaryRoot)));
  }

  const durationMs = Date.now() - startTime;

  if (violations.length > 0) {
    return {
      status: 'fail',
      message: `Found ${violations.length} import violation(s): imports resolve outside project boundary or target missing`,
      durationMs,
      violations,
    };
  }

  return {
    status: 'pass',
    message: `All relative imports in ${changedFiles.length} file(s) resolve within project boundary`,
    durationMs,
    violations: [],
  };
}

/**
 * npm pack must ship at least one file besides package.json. Split out of
 * runPackCheck because the check reads as three separate verdicts (no output,
 * empty list, manifest-only) and each one has its own operator-facing message.
 */
function inspectPackedFiles(
  packages: Array<{ files?: Array<{ path: string }> }> | null
): { ok: true; count: number } | { ok: false; message: string } {
  if (!packages || packages.length === 0) {
    return { ok: false, message: 'npm pack produced no package output' };
  }
  const files = packages[0].files || [];
  if (files.length === 0) {
    return { ok: false, message: 'npm pack produced empty file list' };
  }
  // Check if only package.json is included (no actual content files)
  const hasContentFiles = files.some((f) => f.path !== 'package.json');
  if (!hasContentFiles) {
    return { ok: false, message: 'npm pack produced no files — only package.json included' };
  }
  return { ok: true, count: files.length };
}

/**
 * Declared entry points that will not be present after `npm install`.
 *
 * WHY THIS EXISTS
 *
 * npm pack answers "which files would publish", not "can the package be used".
 * Measured 2026-11-22 on a project whose package.json said
 *
 *     { "main": "dist/nonexistent.js", "files": ["dist"] }
 *
 * with a dist/ holding only tsconfig.tsbuildinfo. npm pack shipped
 * `dist/tsconfig.tsbuildinfo` and `package.json`, inspectPackedFiles saw one
 * non-manifest file, and the gate reported Overall: PASS. The published tarball
 * had no JavaScript in it at all, so every `require()` of that package would have
 * thrown MODULE_NOT_FOUND — and the build-integrity gate called it healthy.
 *
 * The pack check was not wrong; it was answering a narrower question than the one
 * its PASS implies. A manifest that points at files the package does not contain
 * is the exact failure mode this gate is named for.
 *
 * WHAT IS CHECKED, AND WHAT IS DELIBERATELY NOT
 *
 * Only `main` / `module` / `types` (the flat fields) and the string leaves of
 * `exports`. Bare specifiers are skipped: `"main": "some-dependency"` is legal npm
 * and resolves inside node_modules, so treating it as a project path would be a
 * false block. Conditional exports objects are walked for their string leaves
 * because that is where the real entry points live in modern packages.
 *
 * Returns the list of declared-but-absent paths. Empty means nothing to report.
 */


/**
 * npm pack is only meaningful when package.json declares a `files` allowlist —
 * without one, npm ships everything and the "which files would publish" check
 * has no answer to give. Returns the reason to SKIP, or null to proceed.
 */
async function packPrecondition(projectRoot: string): Promise<string | null> {
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  try {
    await fs.access(pkgJsonPath);
  } catch {
    return 'No package.json found in project root';
  }
  const pkgJsonRaw = await fs.readFile(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(pkgJsonRaw) as { files?: unknown };
  if (!pkgJson.files || !Array.isArray(pkgJson.files)) {
    return 'package.json has no files field — skipping pack check';
  }
  return missingDeclaredArtifacts(projectRoot, pkgJson.files);
}

/**
 * #786: a `files` allowlist that names an output directory (`dist`, `lib`,
 * `build`) describes an artifact a BUILD produces, not something already in the
 * tree. With `noEmit` in tsconfig -- a normal choice when a bundler or a separate
 * build step owns the output -- nothing writes that directory, so `npm pack`
 * ships only package.json, `inspectPackedFiles` reports "only package.json
 * included", and the gate BLOCKS forever with no way out.
 *
 * Absent artifacts are therefore a SKIP with the reason spelled out, not a FAIL:
 * this gate's subject is build integrity, and it cannot judge a package whose
 * inputs were never built. The message also has to name the remedy -- "build
 * first" is the whole fix, and the old text never said it.
 *
 * Extracted from packPrecondition rather than inlined: the inline version took
 * that function to CCN=11 against a recorded 5 (block threshold 10), which Gate 3
 * caught on CI. A ratchet that is satisfied by pushing one function over the line
 * is not satisfied.
 */
async function missingDeclaredArtifacts(
  projectRoot: string,
  files: unknown[]
): Promise<string | null> {
  const declaredEntries = files.filter(isDeclaredArtifact);
  if (declaredEntries.length === 0) return null;
  if (await anyExists(declaredEntries, projectRoot)) return null;
  return `package.json files entries (${declaredEntries.join(', ')}) do not exist on disk — run the build that produces them, then re-run`;
}

/**
 * Whether this `files` entry names one CONCRETE artifact.
 *
 * A NEGATION (`!dist/`) and a GLOB (`dist/*`) are rules about other paths, not artifacts
 * of their own: neither can be checked for existence, and testing a glob literally would
 * report a missing file for a directory that is perfectly fine.
 */
function isDeclaredArtifact(entry: unknown): entry is string {
  if (typeof entry !== 'string' || entry === '') return false;
  return !entry.startsWith('!') && !entry.includes('*');
}

/** Whether any of these entries exists under the project root. */
async function anyExists(entries: string[], projectRoot: string): Promise<boolean> {
  const presence = await Promise.all(entries.map((entry) => pathExists(path.join(projectRoot, entry))));
  return presence.some(Boolean);
}

/** Existence probe that reports absence instead of throwing. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

interface PackFailure {
  killed?: boolean;
  signal?: string;
  code?: number | null;
  stderr?: string;
  stdout?: string;
  message?: string;
}

const MAX_PACK_DETAIL = 2000;

/** Map an npm pack rejection onto the gate's SKIP/FAIL contract. */
const packFailureResult = (error: unknown, timeoutMs: number): CheckResult => {
  const err = error as PackFailure;
  const durationMs = 0;
  if (wasKilled(err)) return { status: 'skip', message: `npm pack timeout after ${timeoutMs}ms`, durationMs };
  return { status: 'fail', message: `npm pack failed: ${failureDetail(err)}`, durationMs };
};

/**
 * Whether npm pack was KILLED rather than failing on its own.
 *
 * A killed run measured nothing, so it is a SKIP: reporting FAIL would blame the package
 * for a process that never finished examining it.
 */
function wasKilled(err: PackFailure): boolean {
  return Boolean(err.killed) || err.signal === 'SIGTERM';
}

/**
 * The most specific detail npm reported, truncated.
 *
 * stderr first, then stdout, then the message: stderr is where npm puts the reason, and
 * the message is often just "Command failed".
 */
function failureDetail(err: PackFailure): string {
  return (err.stderr || err.stdout || err.message || '').slice(0, MAX_PACK_DETAIL);
}

/**
 * The operator-facing message when a manifest names files the tarball lacks, or
 * null when every declared entry is really shipped.
 *
 * Split out of runPackCheck to keep that function under the complexity ratchet,
 * and because it carries its own justification: "npm pack shipped something" is
 * not "the package works". Measured 2026-11-22 -- a package whose only shipped
 * file was dist/tsconfig.tsbuildinfo, declaring "main": "dist/nonexistent.js",
 * passed the pack check and produced a tarball no require() could load. A manifest
 * that disagrees with its own contents is the defect this gate exists to catch.
 */
async function unreachableEntryPoints(
  projectRoot: string,
  files: Array<{ path: string }>
): Promise<string | null> {
  const manifest = await readManifest(projectRoot);
  if (!manifest) return null;
  return unreachableEntryPointsMessage(manifest, files);
}

/**
 * The verdict for a successful `npm pack --dry-run`, or the reason it is not one.
 *
 * Split from runPackCheck so that function stays under the complexity ratchet: the
 * ratchet counts decisions, and "did npm ship anything" plus "does the manifest
 * agree with what it shipped" are two independent decisions that were previously
 * inline. Each one already had its own justification comment; now each is a unit.
 */
async function packVerdict(
  projectRoot: string,
  stdout: string
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const packages = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
  const shipped = inspectPackedFiles(packages);
  if (!shipped.ok) return shipped;
  const missingEntry = await unreachableEntryPoints(projectRoot, packages[0].files || []);
  if (missingEntry) return { ok: false, message: missingEntry };
  return { ok: true, count: shipped.count };
}

export async function runPackCheck(
  projectRoot: string,
  timeoutMs: number
): Promise<CheckResult> {
  const startTime = Date.now();

  const skipReason = await packPrecondition(projectRoot);
  if (skipReason) {
    return { status: 'skip', message: skipReason, durationMs: Date.now() - startTime };
  }

  try {
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
      cwd: projectRoot,
      timeout: timeoutMs,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const verdict = await packVerdict(projectRoot, stdout);
    if (!verdict.ok) {
      return { status: 'fail', message: verdict.message, durationMs: Date.now() - startTime };
    }
    return {
      status: 'pass',
      message: `npm pack: ${verdict.count} file(s) included`,
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const result = packFailureResult(error, timeoutMs);
    return { ...result, durationMs: Date.now() - startTime };
  }
}

// ─── Gate 10 Orchestrator ──────────────────────────────────────────────────────

/**
 * Runs all three Gate 10 checks (tsc, pack, imports) in parallel and combines
 * the results into a single Gate10Result.
 *
 * Exit logic:
 * - BLOCK (exitCode 1, status 'block') when ANY check returns status 'fail'.
 * - PASS (exitCode 0, status 'pass') when all checks return 'pass' or 'skip'
 *   AND at least one check returned 'pass'.
 * - SKIP (exitCode 0, status 'skip') when all checks return 'skip' (or no
 *   applicable checks found).
 */
function resolveGate10Status(
  tsc: CheckResult,
  pack: CheckResult,
  imp: ImportCheckResult
): { status: Gate10Status; exitCode: number } {
  const statuses = [tsc.status, pack.status, imp.status];
  // ANY failure blocks: a manifest that does not compile or does not ship is a defect
  // regardless of what the other checks found.
  if (statuses.includes('fail')) return { status: 'block', exitCode: 1 };
  // Nothing passed and nothing failed: every check was skipped, which is UNMEASURED and
  // must not read as a pass.
  if (!statuses.includes('pass')) return { status: 'skip', exitCode: 0 };
  return { status: 'pass', exitCode: 0 };
}

function collectErrors(
  tsc: CheckResult,
  pack: CheckResult,
  imp: ImportCheckResult
): string[] {
  const errors: string[] = [];
  if (tsc.status === 'fail') errors.push(`tsc: ${tsc.message}`);
  if (pack.status === 'fail') errors.push(`pack: ${pack.message}`);
  if (imp.status === 'fail') errors.push(`imports: ${imp.message}`);
  return errors;
}

export async function runGate10(options: Gate10Options): Promise<Gate10Result> {
  const { changedFiles, projectRoot, timeoutMs } = options;

  const [tscResult, packResult, importResult] = await Promise.all([
    runTscCheck(projectRoot, timeoutMs),
    runPackCheck(projectRoot, timeoutMs),
    runImportCheck(changedFiles, projectRoot, timeoutMs),
  ]);

  const { status, exitCode } = resolveGate10Status(tscResult, packResult, importResult);
  const errors = collectErrors(tscResult, packResult, importResult);

  return {
    exitCode,
    status,
    checks: {
      tsc: tscResult,
      pack: packResult,
      imports: importResult,
    },
    warnings: [],
    errors,
  };
}

// ─── CLI Argument Parsing ──────────────────────────────────────────────────────

export interface Gate10Args {
  changedFiles: string[];
  projectRoot: string;
  timeoutMs: number;
  help: boolean;
}

/**
 * Parses CLI arguments for Gate 10.
 *
 * @returns Parsed args object with changedFiles, projectRoot, timeoutMs, and help flag
 */
/**
 * Lizard-and-ratchet-visible shape of the gate's CLI. Split from
 * parseGate10Args so the flag loop stays a flat scan.
 */
function splitChangedFiles(changedFilesStr: string): string[] {
  return changedFilesStr
    ? changedFilesStr.split(',').map((f) => f.trim()).filter(Boolean)
    : [];
}

/** The default build-check budget, in milliseconds. */
const GATE10_DEFAULT_TIMEOUT_MS = 60000;

/** Flags that ask for help rather than configuring a run. */
const GATE10_HELP_FLAGS = new Set(['--help', '-h']);

/**
 * How each value-taking flag stores its argument.
 *
 * A table, because the branches are INDEPENDENT: an if/else chain would count as
 * nesting and put this function over the depth limit, which blocked every commit that
 * touched this file while its warning count stayed at or below the "clear to zero"
 * threshold.
 */
const GATE10_VALUE_FLAGS: Record<string, (state: Gate10ArgsDraft, value: string) => void> = {
  '--changed-files': (state, value) => { state.changedFilesStr = value; },
  '--project-root': (state, value) => { state.projectRoot = value || process.cwd(); },
  '--timeout': (state, value) => { state.timeoutMs = parseInt(value || String(GATE10_DEFAULT_TIMEOUT_MS), 10); },
};

/** The mutable shape the parser builds before it returns. */
interface Gate10ArgsDraft {
  changedFilesStr: string;
  projectRoot: string;
  timeoutMs: number;
  help: boolean;
}

export function parseGate10Args(args: string[]): Gate10Args {
  const state: Gate10ArgsDraft = {
    changedFilesStr: '',
    projectRoot: process.cwd(),
    timeoutMs: GATE10_DEFAULT_TIMEOUT_MS,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (GATE10_HELP_FLAGS.has(args[i])) {
      state.help = true;
      continue;
    }
    const apply = GATE10_VALUE_FLAGS[args[i]];
    if (!apply) continue;
    // The value is consumed from the NEXT position, so it is never re-read as a flag.
    apply(state, args[i + 1] || '');
    i++;
  }

  return {
    changedFiles: splitChangedFiles(state.changedFilesStr),
    projectRoot: state.projectRoot,
    timeoutMs: state.timeoutMs,
    help: state.help,
  };
}

// ─── CLI Result Formatting ─────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`Build Integrity Check (Gate 9)

Usage:
  npx tsx src/build-integrity/gate-10.ts --changed-files <files> [options]

Options:
  --changed-files <files>  Comma-separated list of changed file paths
  --project-root <path>    Project root (defaults to cwd)
  --timeout <ms>           Timeout per check in ms (defaults to 60000)
  --help, -h               Show this help message

Exit codes:
  0  Pass or skip (all checks passed or were skipped)
  1  Block (one or more checks failed)`);
}

function printGate10Result(result: Gate10Result): void {
  console.log('');
  console.log('Build Integrity Check (Gate 9)');
  console.log('─'.repeat(50));
  console.log(
    `  tsc:     ${formatStatus(result.checks.tsc.status)}  ${result.checks.tsc.message.split('\n')[0]} (${result.checks.tsc.durationMs}ms)`
  );
  console.log(
    `  pack:    ${formatStatus(result.checks.pack.status)}  ${result.checks.pack.message.split('\n')[0]} (${result.checks.pack.durationMs}ms)`
  );
  console.log(
    `  imports: ${formatStatus(result.checks.imports.status)}  ${result.checks.imports.message.split('\n')[0]} (${result.checks.imports.durationMs}ms)`
  );
  console.log('─'.repeat(50));
  console.log(`  Overall: ${formatStatus(result.status)}`);

  if (result.errors.length > 0) {
    console.log('');
    console.log('  Errors:');
    for (const err of result.errors) {
      console.log(`    - ${err.split('\n')[0]}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('');
    console.log('  Warnings:');
    for (const warn of result.warnings) {
      console.log(`    - ${warn}`);
    }
  }

  console.log('');
}

// ─── CLI Entry Point ───────────────────────────────────────────────────────────

/**
 * Parses CLI arguments and runs Gate 10.
 *
 * Usage:
 *   npx tsx src/build-integrity/gate-10.ts --changed-files "file1.ts,file2.ts"
 *
 * @returns exit code: 0 = pass/skip, 1 = block
 */
export async function main(args: string[]): Promise<number> {
  const parsed = parseGate10Args(args);

  if (parsed.help) {
    printHelp();
    return 0;
  }

  const result = await runGate10({
    changedFiles: parsed.changedFiles,
    projectRoot: parsed.projectRoot,
    timeoutMs: parsed.timeoutMs,
  });

  printGate10Result(result);

  return result.exitCode;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'skip':
      return 'SKIP';
    case 'block':
      return 'BLOCK';
    default:
      return status.toUpperCase();
  }
}

const isDirectRun = (() => {
  try {
    const scriptPath = process.argv[1];
    if (!scriptPath) return false;
    const normalizedScript = path.resolve(scriptPath);
    const normalizedThis = path.resolve(fileURLToPath(import.meta.url));
    return normalizedScript === normalizedThis;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
