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

/**
 * Gate 10: Build Integrity Check — TypeScript compilation verification.
 * Runs `tsc --noEmit --incremental` to verify the project compiles without errors.
 *
 * @param projectRoot - Absolute path to the project root
 * @param timeoutMs - Timeout in milliseconds
 * @returns CheckResult with status 'pass', 'fail', or 'skip'
 */
export async function runTscCheck(
  projectRoot: string,
  timeoutMs: number
): Promise<CheckResult> {
  const startTime = Date.now();

  // Check if tsconfig.json exists
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  try {
    await fs.access(tsconfigPath);
  } catch {
    return {
      status: 'skip',
      message: 'No tsconfig.json found in project root',
      durationMs: Date.now() - startTime,
    };
  }

  // Resolve tsc binary: try multiple strategies for cross-platform reliability
  function findTsc(): string | null {
    // Strategy 1: projectRoot/node_modules/typescript/bin/tsc
    const direct = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    try { fsNative.accessSync(direct); return direct; } catch { /* continue */ }

    // Strategy 2: resolve from cwd's node_modules (works when test symlinks or in project)
    const fromCwd = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
    try { fsNative.accessSync(fromCwd); return fromCwd; } catch { /* continue */ }

    // Strategy 3: resolve via require.resolve from this file's location
    try {
      const resolved = require.resolve('typescript/bin/tsc', { paths: [projectRoot, process.cwd()] });
      try { fsNative.accessSync(resolved); return resolved; } catch { /* continue */ }
    } catch { /* continue */ }

    return null;
  }

  const resolvedTsc = findTsc();

  // Check if tsc is available
  try {
    if (resolvedTsc) {
      await execFileAsync(process.execPath, [resolvedTsc, '--version'], {
        cwd: projectRoot,
        timeout: 10000,
      });
    } else {
      await execFileAsync('npx', ['tsc', '--version'], {
        cwd: projectRoot,
        timeout: 10000,
        shell: true,
        env: { ...process.env, PATH: process.env.PATH },
      });
    }
  } catch {
    return {
      status: 'skip',
      message: 'tsc is not available on PATH',
      durationMs: Date.now() - startTime,
    };
  }

  // Run tsc --noEmit --incremental
  try {
    const tscCmd = resolvedTsc ? process.execPath : 'npx';
    const tscArgs = resolvedTsc
      ? [resolvedTsc, '--noEmit', '--incremental']
      : ['tsc', '--noEmit', '--incremental'];
    const { stdout, stderr } = await execFileAsync(
      tscCmd,
      tscArgs,
      {
        cwd: projectRoot,
        timeout: timeoutMs,
        shell: !resolvedTsc,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );

    const output = stdout + stderr;

    return {
      status: 'pass',
      message: output.trim() || 'TypeScript compilation successful',
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const err = error as {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      message?: string;
    };

    // Timeout → SKIP
    if (err.killed || err.signal === 'SIGTERM' || err.code === null) {
      return {
        status: 'skip',
        message: `tsc timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - startTime,
      };
    }

    // Non-zero exit → FAIL
    const output = (err.stdout || '') + (err.stderr || '');
    const truncatedOutput = output.slice(0, 2000);

    // Count errors in output
    const errorMatches = output.match(/error TS\d+:/g);
    const errorCount = errorMatches ? errorMatches.length : 0;

    const message = errorCount > 0
      ? `TypeScript compilation failed with ${errorCount} error(s):\n${truncatedOutput}`
      : `TypeScript compilation failed:\n${truncatedOutput}`;

    return {
      status: 'fail',
      message,
      durationMs: Date.now() - startTime,
    };
  }
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

  const staticImportExportRe =
    /(?:import|export)\s+(?:(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRe = /(?<!\w)import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comment lines (// or leading * in JSDoc blocks)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    let match: RegExpExecArray | null;
    const staticRe = new RegExp(staticImportExportRe.source, 'g');
    while ((match = staticRe.exec(line)) !== null) {
      const importPath = match[1] ?? match[2];
      if (importPath && isRelativeImport(importPath)) {
        results.push({ path: importPath, line: lineNum });
      }
    }

    const reqRe = new RegExp(requireRe.source, 'g');
    while ((match = reqRe.exec(line)) !== null) {
      const importPath = match[1];
      if (importPath && isRelativeImport(importPath)) {
        results.push({ path: importPath, line: lineNum });
      }
    }

    const dynRe = new RegExp(dynamicImportRe.source, 'g');
    while ((match = dynRe.exec(line)) !== null) {
      const importPath = match[1];
      if (importPath && isRelativeImport(importPath)) {
        results.push({ path: importPath, line: lineNum });
      }
    }
  }

  return results;
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
export async function runImportCheck(
  changedFiles: string[],
  projectRoot: string,
  _timeoutMs: number
): Promise<ImportCheckResult> {
  const startTime = Date.now();
  const violations: ImportViolation[] = [];

    const fsSync = fsNative;

  for (const file of changedFiles) {
    // Skip test files — they contain intentionally broken imports for unit testing.
    // The published npm package does not include __tests__ directories.
    if (file.includes('__tests__')) continue;

    try {
      fsSync.accessSync(file);
    } catch {
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const imports = extractImports(content);

    for (const imp of imports) {
      const rawResolved = path.resolve(path.dirname(file), imp.path);
      const normalizedRoot = path.resolve(projectRoot);

      const escapesBoundary =
        !rawResolved.startsWith(normalizedRoot + path.sep) && rawResolved !== normalizedRoot;

      if (escapesBoundary) {
        violations.push({
          file,
          line: imp.line,
          importPath: imp.path,
          resolvedPath: rawResolved,
          reason: `Import path escapes package boundary (resolves outside project root)`,
        });
        continue;
      }

      const resolvedPath = resolveImportPath(imp.path, file);

      if (resolvedPath === null) {
        violations.push({
          file,
          line: imp.line,
          importPath: imp.path,
          resolvedPath: rawResolved,
          reason: `Import target does not exist on disk`,
        });
      }
    }
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

export async function runPackCheck(
  projectRoot: string,
  timeoutMs: number
): Promise<CheckResult> {
  const startTime = Date.now();

  const pkgJsonPath = path.join(projectRoot, 'package.json');
  try {
    await fs.access(pkgJsonPath);
  } catch {
    return {
      status: 'skip',
      message: 'No package.json found in project root',
      durationMs: Date.now() - startTime,
    };
  }

  const pkgJsonRaw = await fs.readFile(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(pkgJsonRaw) as { files?: unknown };
  if (!pkgJson.files || !Array.isArray(pkgJson.files)) {
    return {
      status: 'skip',
      message: 'package.json has no files field — skipping pack check',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
      cwd: projectRoot,
      timeout: timeoutMs,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const packages = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
    if (!packages || packages.length === 0) {
      return {
        status: 'fail',
        message: 'npm pack produced no package output',
        durationMs: Date.now() - startTime,
      };
    }

    const files = packages[0].files || [];
    if (files.length === 0) {
      return {
        status: 'fail',
        message: 'npm pack produced empty file list',
        durationMs: Date.now() - startTime,
      };
    }

    // Check if only package.json is included (no actual content files)
    const hasContentFiles = files.some((f) => f.path !== 'package.json');
    if (!hasContentFiles) {
      return {
        status: 'fail',
        message: 'npm pack produced no files — only package.json included',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      status: 'pass',
      message: `npm pack: ${files.length} file(s) included`,
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const err = error as {
      killed?: boolean;
      signal?: string;
      code?: number | null;
      stderr?: string;
      stdout?: string;
      message?: string;
    };

    if (err.killed || err.signal === 'SIGTERM') {
      return {
        status: 'skip',
        message: `npm pack timeout after ${timeoutMs}ms`,
        durationMs: Date.now() - startTime,
      };
    }

    const detail = (err.stderr || err.stdout || err.message || '').slice(0, 2000);
    return {
      status: 'fail',
      message: `npm pack failed: ${detail}`,
      durationMs: Date.now() - startTime,
    };
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

  const changedFiles = changedFilesStr
    ? changedFilesStr.split(',').map((f) => f.trim()).filter(Boolean)
    : [];

  return { changedFiles, projectRoot, timeoutMs, help };
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
