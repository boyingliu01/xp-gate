import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const tscSkipReason = async (projectRoot: string): Promise<string | null> => {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  try {
    await fs.access(tsconfigPath);
  } catch {
    return 'No tsconfig.json found in project root';
  }
  const resolvedTsc = findTscBinary(projectRoot);
  try {
    const probe = tscProbeInvocation(projectRoot, resolvedTsc);
    await execFileAsync(probe.cmd, probe.args, probe.opts);
  } catch {
    return 'tsc is not available on PATH';
  }
  return null;
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
 */
export function extractImports(content: string): Array<{ path: string; line: number }> {
  const results: Array<{ path: string; line: number }> = [];
  const lines = content.split('\n');
  const push = (path: string, line: number) => { results.push({ path, line }); };

  const staticImportExportRe =
    /(?:import|export)\s+(?:(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRe = /(?<!\w)import\(\s*['"]([^'"]+)['"]\s*\)/g;

  // LINE-major order is the contract (import-resolver.test pins it): one pass
  // over the lines, three patterns per line in static → require → dynamic
  // order — exactly the inline version's nesting. Do not reorder into
  // pattern-major passes; a line containing both a require and an import
  // would then swap positions.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines (// or leading * in JSDoc blocks)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    scanLine(line, i + 1, staticImportExportRe, (m) => m[1] ?? m[2], push);
    scanLine(line, i + 1, requireRe, (m) => m[1], push);
    scanLine(line, i + 1, dynamicImportRe, (m) => m[1], push);
  }

  return results;
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

export function resolveImportPath(importPath: string, fromFile: string): string | null {
  if (!isRelativeImport(importPath)) return null;

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  const ext = path.extname(importPath);
  if (ext) {
    if (tryAccess(resolved)) return resolved;
    if (ext === '.js') {
      if (tryAccess(resolved.slice(0, -3) + '.ts')) return resolved.slice(0, -3) + '.ts';
      if (tryAccess(resolved.slice(0, -3) + '.tsx')) return resolved.slice(0, -3) + '.tsx';
    }
    return null;
  }

  for (const tryExt of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    if (tryAccess(resolved + tryExt)) return resolved + tryExt;
  }

  for (const idxName of ['index.ts', 'index.js']) {
    const candidate = path.join(resolved, idxName);
    if (tryAccess(candidate)) return candidate;
  }

  return null;
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
  return null;
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
  if (err.killed || err.signal === 'SIGTERM') {
    return { status: 'skip', message: `npm pack timeout after ${timeoutMs}ms`, durationMs };
  }
  const detail = (err.stderr || err.stdout || err.message || '').slice(0, MAX_PACK_DETAIL);
  return { status: 'fail', message: `npm pack failed: ${detail}`, durationMs };
};

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

    const verdict = inspectPackedFiles(JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>);
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
  const anyFail = tsc.status === 'fail' || pack.status === 'fail' || imp.status === 'fail';
  if (anyFail) return { status: 'block', exitCode: 1 };

  const anyPass = tsc.status === 'pass' || pack.status === 'pass' || imp.status === 'pass';
  if (!anyPass) return { status: 'skip', exitCode: 0 };

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

export function parseGate10Args(args: string[]): Gate10Args {
  let changedFilesStr = '';
  let projectRoot = process.cwd();
  let timeoutMs = 60000;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--changed-files') {
      changedFilesStr = args[++i] || '';
    } else if (arg === '--project-root') {
      projectRoot = args[++i] || process.cwd();
    } else if (arg === '--timeout') {
      timeoutMs = parseInt(args[++i] || '60000', 10);
    }
  }

  return { changedFiles: splitChangedFiles(changedFilesStr), projectRoot, timeoutMs, help };
}

// ─── CLI Result Formatting ─────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`Gate 10: Build Integrity Check

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
  console.log('Gate 10: Build Integrity Check');
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
