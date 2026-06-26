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

  // Check if tsc is available (run from projectRoot where node_modules should exist)
  try {
    await execFileAsync('npx', ['tsc', '--version'], {
      cwd: projectRoot,
      timeout: 5000,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch {
    return {
      status: 'skip',
      message: 'tsc is not available on PATH',
      durationMs: Date.now() - startTime,
    };
  }

  // Run tsc --noEmit --incremental
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsc', '--noEmit', '--incremental'],
      {
        cwd: projectRoot,
        timeout: timeoutMs,
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
export function resolveImportPath(importPath: string, fromFile: string): string | null {
  if (!isRelativeImport(importPath)) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  const indexExtensions = ['/index.ts', '/index.js'];

  const ext = path.extname(importPath);
  if (ext) {
    try {
      fsNative.accessSync(resolved);
      return resolved;
    } catch {
      if (ext === '.js') {
        const tsPath = resolved.slice(0, -3) + '.ts';
        try {
          fsNative.accessSync(tsPath);
          return tsPath;
        } catch {
          // fall through
        }
        const tsxPath = resolved.slice(0, -3) + '.tsx';
        try {
          fsNative.accessSync(tsxPath);
          return tsxPath;
        } catch {
          // fall through
        }
      }
      return null;
    }
  }

  for (const tryExt of extensions) {
    const candidate = resolved + tryExt;
    try {
      fsNative.accessSync(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  for (const indexExt of indexExtensions) {
    const candidate = resolved + indexExt;
    try {
      fsNative.accessSync(candidate);
      return candidate;
    } catch {
      // continue
    }
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
export async function runGate10(options: Gate10Options): Promise<Gate10Result> {
  const { changedFiles, projectRoot, timeoutMs } = options;

  const [tscResult, packResult, importResult] = await Promise.all([
    runTscCheck(projectRoot, timeoutMs),
    runPackCheck(projectRoot, timeoutMs),
    runImportCheck(changedFiles, projectRoot, timeoutMs),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (tscResult.status === 'fail') {
    errors.push(`tsc: ${tscResult.message}`);
  }
  if (packResult.status === 'fail') {
    errors.push(`pack: ${packResult.message}`);
  }
  if (importResult.status === 'fail') {
    errors.push(`imports: ${importResult.message}`);
  }

  const anyFail =
    tscResult.status === 'fail' ||
    packResult.status === 'fail' ||
    importResult.status === 'fail';

  const allSkip =
    tscResult.status === 'skip' &&
    packResult.status === 'skip' &&
    importResult.status === 'skip';

  const allSkipOrPass =
    (tscResult.status === 'skip' || tscResult.status === 'pass') &&
    (packResult.status === 'skip' || packResult.status === 'pass') &&
    (importResult.status === 'skip' || importResult.status === 'pass');

  const anyPass =
    tscResult.status === 'pass' ||
    packResult.status === 'pass' ||
    importResult.status === 'pass';

  let status: Gate10Status;
  let exitCode: number;

  if (anyFail) {
    status = 'block';
    exitCode = 1;
  } else if (allSkip || (allSkipOrPass && !anyPass)) {
    status = 'skip';
    exitCode = 0;
  } else {
    status = 'pass';
    exitCode = 0;
  }

  return {
    exitCode,
    status,
    checks: {
      tsc: tscResult,
      pack: packResult,
      imports: importResult,
    },
    warnings,
    errors,
  };
}

// ─── CLI Entry Point ───────────────────────────────────────────────────────────

/**
 * Parses CLI arguments and runs Gate 10.
 *
 * Usage:
 *   npx tsx src/build-integrity/gate-10.ts --changed-files "file1.ts,file2.ts"
 *
 * Options:
 *   --changed-files <files>  Comma-separated list of changed file paths
 *   --project-root <path>    Project root (defaults to cwd)
 *   --timeout <ms>           Timeout per check in ms (defaults to 60000)
 *   --help                   Show usage information
 *
 * @returns exit code: 0 = pass/skip, 1 = block
 */
export async function main(args: string[]): Promise<number> {
  let changedFilesStr = '';
  let projectRoot = process.cwd();
  let timeoutMs = 60000;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
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
      return 0;
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

  const result = await runGate10({
    changedFiles,
    projectRoot,
    timeoutMs,
  });

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
