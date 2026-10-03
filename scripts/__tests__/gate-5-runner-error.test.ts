/**
 * @test REQ-454
 * @intent Gate 5 must distinguish a real test failure from a vitest *runner
 *         infrastructure* error (EPERM on the temp/ssr module cache), so the
 *         guard cannot silently regress to a blanket "Tests FAILED" message.
 * @covers AC-454-01, AC-454-02, AC-454-03, AC-454-04, AC-454-06
 *
 * Background: on Windows vitest 1.6.x can exit non-zero while reporting zero
 * failed tests. `is_runner_infrastructure_error` already existed, but only ONE
 * of the six `BLOCKED - Tests FAILED` sites consulted it -- so the four vitest
 * sites that can actually emit the EPERM signature mostly fell through to the
 * blanket message, sending developers hunting for a nonexistent bug.
 *
 * These tests drive the REAL hook (not a reimplementation): the hook is invoked
 * with a stub `npx` on PATH that replays canned vitest output, and the resulting
 * message is asserted. That is the only way to prove the guard is *wired* --
 * a unit test of the helper alone would pass even if no call site used it.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const HOOK = join(REPO_ROOT, 'githooks', 'pre-commit');

/** Git Bash ships with Git for Windows; `bash` on PATH resolves to the WSL launcher. */
function bashPath(): string {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    '/usr/bin/bash',
    '/bin/bash',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'bash';
}

/**
 * Convert a Windows path into the POSIX form Git Bash understands (`/c/...`).
 *
 * This matters for PATH entries: a Windows-form entry (`C:/Users/...`) does NOT
 * take precedence over the real `C:\Program Files\nodejs\npx`, so a stub placed
 * there is silently bypassed and the real npx runs -- which made an earlier
 * version of this test pass vacuously.
 */
function toPosixPath(winPath: string): string {
  return `/${winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase())}`;
}

/** POSIX form for shell arguments (command substitution, `cd`, etc.). */
function toBashPath(winPath: string): string {
  return winPath.replace(/\\/g, '/');
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

interface StubResult {
  stdout: string;
  exitCode: number;
  callsFile: string;
}

/** Hook output can be large (the whole hook log); give the buffer room. */
const MEBIBYTE = 1024 * 1024;
const MAX_BUFFER_BYTES = 32 * MEBIBYTE;

/** How far past the fallback marker to inspect when asserting it is unguarded. */
const FALLBACK_BLOCK_CHARS = 2500;

/** Minimum number of Gate 5 vitest branches that must route through the helper. */
const MIN_GUARDED_BRANCHES = 4;

/** Maximum hand-rolled BLOCKED sites: 1 in the helper + 2 generic fallbacks. */
const MAX_HANDROLLED_BLOCK_SITES = 3;

/**
 * Write the stub `npx` into `bin` and return the path of its call log.
 * Throws with the failing path so a fixture problem is distinguishable from a
 * hook-behaviour failure.
 */
function writeStubNpx(bin: string, sandbox: string, output: string, exit: number): string {
  const callsFile = join(sandbox, 'npx-calls.log');
  // The stub must be named exactly `npx` inside `bin`, because `bin` is what we
  // prepend to PATH. (Writing it elsewhere made a previous test pass vacuously
  // while the real npx ran.)
  //
  // The hook first probes `npx vitest --version` to decide whether vitest is
  // available, so the stub must answer that probe successfully; every other
  // invocation replays the canned output and exit code under test.
  const stubBody = [
    '#!/bin/bash',
    `echo "$*" >> "${toBashPath(callsFile)}"`,
    'case "$*" in',
    '  *--version*) echo "vitest/1.6.1"; exit 0 ;;',
    'esac',
    `cat <<'XPGATE_VITEST_OUT'`,
    output,
    'XPGATE_VITEST_OUT',
    `exit ${exit}`,
  ].join('\n');
  const stub = join(bin, 'npx');
  try {
    mkdirSync(bin, { recursive: true });
    writeFileSync(stub, stubBody, 'utf8');
    chmodSync(stub, 0o755);
  } catch (err) {
    throw new Error(`Cannot write the stub npx fixture at ${stub}: ${String(err)}`);
  }
  return callsFile;
}

/**
 * Create a throwaway git repo whose only staged changes are a source file and a
 * test file, so Gate 5 takes its "changed test files" branch.
 *
 * A `@vitest/coverage-v8` module is planted because the hook asks vitest for
 * coverage; without it vitest aborts with "MISSING DEPENDENCY", a *different*
 * non-zero exit that would mask the guard under test.
 */
function createProjectFixture(sandbox: string): string {
  const project = join(sandbox, 'project');
  const coveragePkg = join(project, 'node_modules', '@vitest', 'coverage-v8');
  const source = 'export const x = 1;\n';
  try {
    mkdirSync(join(project, 'src', '__tests__'), { recursive: true });
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0' }),
      'utf8'
    );
    writeFileSync(join(project, 'src', 'index.ts'), source, 'utf8');
    writeFileSync(join(project, 'src', '__tests__', 'sample.test.ts'), source, 'utf8');

    mkdirSync(coveragePkg, { recursive: true });
    writeFileSync(
      join(coveragePkg, 'package.json'),
      JSON.stringify({ name: '@vitest/coverage-v8', version: '1.6.1', main: 'index.js' }),
      'utf8'
    );
    writeFileSync(join(coveragePkg, 'index.js'), 'module.exports = {};\n', 'utf8');
  } catch (err) {
    throw new Error(`Cannot build the sandbox project fixture at ${project}: ${String(err)}`);
  }
  return project;
}

/**
 * Invoke the hook with a stub `npx` that prints `vitestOutput` and exits with
 * `vitestExit`, returning the hook's own stdout and exit code.
 *
 * The hook is run from a throwaway git repo so no real gate state is touched.
 */
function runHookWithVitestOutput(vitestOutput: string, vitestExit: number): StubResult {
  const sandbox = mkdtempSync(join(tmpdir(), 'xpgate-454-'));
  tempDirs.push(sandbox);

  const bin = join(sandbox, 'bin');
  const callsFile = writeStubNpx(bin, sandbox, vitestOutput, vitestExit);
  const project = createProjectFixture(sandbox);

  const script = [
    `cd "${toBashPath(project)}"`,
    'git init -q -b ci-test',
    'git config user.email t@t.com',
    'git config user.name T',
    'git add -A >/dev/null 2>&1',
    // POSIX form is required here -- see toPosixPath().
    `export PATH="${toPosixPath(bin)}:$PATH"`,
    `bash "${toBashPath(HOOK)}" 2>&1 || echo "__HOOK_EXIT=$?"`,
  ].join(' && ');

  try {
    const stdout = execFileSync(bashPath(), ['-c', script], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    const exitMatch = /__HOOK_EXIT=(\d+)/.exec(stdout);
    return { stdout, exitCode: exitMatch ? Number(exitMatch[1]) : 0, callsFile };
  } catch (err) {
    const e = err as { stdout?: string; status?: number | null };
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1, callsFile };
  }
}

/** Assert the stub actually ran, so a passing result can never be vacuous. */
function assertStubRan(callsFile: string, context: string): void {
  let calls: string;
  try {
    calls = readFileSync(callsFile, 'utf8');
  } catch {
    throw new Error(
      `Anti-vacuity failure (${context}): the stub npx was never invoked, so the ` +
        'assertion would have passed for the wrong reason.'
    );
  }
  if (!/vitest/.test(calls)) {
    throw new Error(
      `Anti-vacuity failure (${context}): the stub npx ran but was never asked to ` +
        `run vitest. Recorded calls:\n${calls}`
    );
  }
}

/** Read the hook source once; several assertions inspect it statically. */
function readHook(): string {
  try {
    return readFileSync(HOOK, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read the hook under test at ${HOOK}: ${String(err)}`);
  }
}

describe('Gate 5 distinguishes runner infrastructure errors from real failures (#454)', () => {
  it('AC-454-01: the guard helper is defined in the hook', () => {
    expect(readHook()).toContain('is_runner_infrastructure_error()');
  });

  it('AC-454-01: the guard is consulted at every vitest Gate 5 block site', () => {
    // Anti-vacuity: a helper that exists but is never called fixes nothing.
    // Before the fix only ONE branch consulted the guard; the four vitest
    // branches must now all route through `handle_test_failure`, which is the
    // single place that consults `is_runner_infrastructure_error`.
    const hook = readHook();
    const callSites = (hook.match(/handle_test_failure "\$TESTS_OUTPUT"/g) ?? []).length;
    expect(callSites).toBeGreaterThanOrEqual(MIN_GUARDED_BRANCHES);
    // And the discriminator must still be what the helper delegates to.
    expect(hook).toContain('if is_runner_infrastructure_error "$_out"');
  });

  it('AC-454-01: no vitest branch hand-rolls its own BLOCKED message', () => {
    // Every `❌ BLOCKED - Tests FAILED` must live inside handle_test_failure;
    // a stray one elsewhere means a branch bypassed the guard.
    const hook = readHook();
    const blockSites = (hook.match(/^\s*echo "❌ BLOCKED - Tests FAILED/gm) ?? []).length;
    expect(blockSites).toBeLessThanOrEqual(MAX_HANDROLLED_BLOCK_SITES);
  });

  it('AC-454-06: the generic run_tests fallback does NOT consult the guard', () => {
    // Non-vitest paths have no guaranteed output shape, so guarding them could
    // let a real failure through. They must keep blocking.
    const hook = readHook();
    const fallbackIndex = hook.indexOf('Fallback: run_tests without coverage');
    expect(fallbackIndex).toBeGreaterThan(-1);
    // Inspect the ~40 lines of that fallback block.
    const block = hook.slice(fallbackIndex, fallbackIndex + FALLBACK_BLOCK_CHARS);
    expect(block).not.toContain('handle_test_failure');
  });

  it('AC-454-02: Unhandled Errors with zero failed tests is SKIPPED, not BLOCKED', () => {
    const out = [
      'Test Files  1 passed (1)',
      '     Tests  14 passed (14)',
      '    Errors  1 error',
      '',
      '\u2500\u2500\u2500\u2500\u2500 Unhandled Errors \u2500\u2500\u2500\u2500\u2500',
      "Error: EPERM: operation not permitted, open '/tmp/ssr/40b9f1f37d5bd759'",
    ].join('\n');
    const { stdout, callsFile } = runHookWithVitestOutput(out, 1);
    assertStubRan(callsFile, 'AC-454-02');
    expect(stdout).not.toContain('BLOCKED - Tests FAILED');
    // Positive assertion: the guard's own message must be what we saw, so the
    // test cannot pass merely because the hook bailed out earlier.
    expect(stdout).toContain('SKIPPED - vitest runner infrastructure error');
  });

  it('AC-454-03: a real test failure still BLOCKS', () => {
    const out = ['Test Files  1 failed (1)', '     Tests  1 failed (1)'].join('\n');
    const { stdout, callsFile } = runHookWithVitestOutput(out, 1);
    assertStubRan(callsFile, 'AC-454-03');
    expect(stdout).toContain('Tests FAILED');
  });

  it('AC-454-04: real-failure markers win when Unhandled Errors are also present', () => {
    const out = [
      '     Tests  1 failed (1)',
      '\u2500\u2500\u2500\u2500\u2500 Unhandled Errors \u2500\u2500\u2500\u2500\u2500',
      'Error: EPERM',
    ].join('\n');
    const { stdout, callsFile } = runHookWithVitestOutput(out, 1);
    assertStubRan(callsFile, 'AC-454-04');
    expect(stdout).toContain('Tests FAILED');
    expect(stdout).not.toContain('SKIPPED - vitest runner infrastructure error');
  });

  it('AC-454-05: a fully passing run PASSES (regression)', () => {
    const out = ['Test Files  1 passed (1)', '     Tests  14 passed (14)'].join('\n');
    const { stdout, callsFile } = runHookWithVitestOutput(out, 0);
    assertStubRan(callsFile, 'AC-454-05');
    // Scope the assertion to Gate 5's own verdict. The sandbox fixture is a bare
    // repo with no .archlint.yaml, so Gate 6 legitimately blocks later; asserting
    // on the whole hook output would make this test about Gate 6, not Gate 5.
    expect(stdout).toContain('PASSED - Changed test files passed');
    expect(stdout).not.toContain('BLOCKED - Tests FAILED');
  });
});
