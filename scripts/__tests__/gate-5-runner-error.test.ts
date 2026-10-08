/**
 * @test REQ-454
 * @intent Gate 5 must distinguish a real test failure from a vitest *runner
 *         infrastructure* error (EPERM on the temp/ssr module cache), so the
 *         guard cannot silently regress to a blanket "Tests FAILED" message.
 * @covers AC-454-01, AC-454-02, AC-454-03, AC-454-04, AC-454-06, AC-454-07, AC-454-08, AC-473-02
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
const LIB = join(REPO_ROOT, 'githooks', 'lib', 'test-failure.sh');

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

/**
 * Minimum number of Gate 5 vitest branches that must route through the helper.
 *
 * 4 branches that call vitest directly, plus the two paths that reach vitest
 * through adapters/typescript.sh's `run_tests` and were added to the guarded side
 * in #498.
 */
const MIN_GUARDED_BRANCHES = 6;

/** Declared vitest major whose default reporter emits the `Unhandled Error` shape. */
const ASSUMED_VITEST_MAJOR = 1;

/**
 * Every copy of the Gate 4 module that branches on the checker's exit status.
 *
 * `githooks/gates/gate-4-principles.sh` is sourced by nothing today; it is listed
 * because the comment under test was copied into it too, and a claim that names
 * this file must hold for it.
 */
const GATE_4_COPIES = [
  'githooks/gate-4.sh',
  'githooks/adapters/gate-4.sh',
  'githooks/gates/gate-4-principles.sh',
];

/** `set -e` in any spelling: bare, bundled (`set -euo pipefail`), or long-form. */
const ERREXIT_OPTION = /(^|[\s;])set\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/;

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

/** Leading-whitespace width of a hook line (tabs counted as two columns). */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
  return lead.replace(/\t/g, '  ').length;
}

/**
 * Which test command produced the BLOCKED at `index`, by walking up to the nearest
 * command that runs tests.
 *
 * The nearest one wins because that is the branch the message belongs to: a fixed
 * character window reached past the fallback's own `run_tests` line into the
 * vitest branches above it and mislabelled every site.
 *
 * The walk is bounded by structure rather than by a line count. A previous version
 * stopped after a fixed number of lines, which was measured against the hook at the
 * time (3) and had to be re-measured every time a reason was written between the
 * command and its block (#498 grew that gap to 13 lines and the assertion silently
 * relabelled the site as belonging to no branch). The bound is now a
 * `handle_test_failure` call at a shallower indent: that means this site is nested
 * inside a branch which already delegated its judgement to the handler, so it
 * cannot inherit a command from above it. A handler at the SAME indent is a sibling
 * arm of the very split #498 introduced, and is not a boundary.
 */
function producingCommand(hook: string, index: number): string {
  const lines = hook.slice(0, index).split('\n');
  const blockedIndent = indentOf(lines[lines.length - 1]);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    // A handler call in a SIBLING arm sits at the same indent as this BLOCKED
    // (#498's split is exactly that: the typescript arm delegates to the handler,
    // the non-vitest arm hand-rolls the message). Only a handler at a shallower
    // indent means this site is nested inside a branch that already delegated.
    if (/handle_test_failure/.test(lines[i]) && indentOf(lines[i]) < blockedIndent) {
      return 'guarded-branch';
    }
    if (/run_without_git_context run_tests/.test(lines[i])) return 'run_tests';
    if (/run_without_git_context npx vitest run/.test(lines[i])) return 'vitest';
  }
  return 'none';
}

/** Gate 5's judgement library, which the hook sources at startup (#473). */
function readLib(): string {
  try {
    return readFileSync(LIB, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read the Gate 5 library under test at ${LIB}: ${String(err)}`);
  }
}

describe('Gate 5 distinguishes runner infrastructure errors from real failures (#454)', () => {
  it('AC-454-01: the guard helper is defined in the library the hook sources', () => {
    // #473 moved the judgement into githooks/lib/test-failure.sh so it can be
    // unit-tested without executing the hook. The hook must still load that library;
    // a hook that ships without lib/ beside it fails closed on every commit.
    expect(readLib()).toContain('is_runner_infrastructure_error()');
    expect(readHook()).toContain('source "${AUDIT_SCRIPT_DIR}/lib/test-failure.sh"');
  });

  it('AC-454-01: the guard is consulted at every vitest Gate 5 block site', () => {
    // Anti-vacuity: a helper that exists but is never called fixes nothing.
    // Before the fix only ONE branch consulted the guard; the four vitest
    // branches must now all route through `handle_test_failure`, which is the
    // single place that consults `is_runner_infrastructure_error`.
    const hook = readHook();
    const callSites = (hook.match(/handle_test_failure "\$TESTS_OUTPUT"/g) ?? []).length;
    expect(callSites).toBeGreaterThanOrEqual(MIN_GUARDED_BRANCHES);
    // And the discriminator must still be what the handler delegates to.
    expect(readLib()).toContain('if is_runner_infrastructure_error "$_out"');
  });

  it('AC-454-01: every hand-rolled BLOCKED site sits in a generic run_tests fallback', () => {
    // The guard's BLOCKED message lives in the library, so any BLOCKED written
    // directly in the hook belongs to a branch that bypassed the guard. That is
    // allowed only for the non-vitest `run_tests` fallback, whose output shape is
    // not vitest's (AC-454-06).
    //
    // This is stated as a property of each site rather than as a cap on the count:
    // an earlier version asserted `sites <= 3`, which failed on every legitimate
    // new fallback and passed on a vitest branch that hand-rolled its own BLOCKED.
    const hook = readHook();
    const sites = [...hook.matchAll(/^(\s*)echo "❌ BLOCKED - Tests FAILED/gm)];
    // Anti-vacuity: the scan must actually find the remaining fallback site.
    // #498 guarded the typescript adapter's own fallback (that branch runs vitest
    // by construction), so exactly one hand-rolled BLOCKED is expected here.
    expect(sites.length).toBeGreaterThanOrEqual(1);
    for (const site of sites) {
      const owner = producingCommand(hook, site.index);
      if (owner !== 'run_tests') {
        throw new Error(
          `Hand-rolled BLOCKED at offset ${site.index} belongs to the \`${owner}\` branch. ` +
            'A vitest branch must route through handle_test_failure instead.'
        );
      }
    }
  });

  it('AC-454-07: the runner-error patterns carry an explicit vitest version assumption', () => {
    // Every output fixture in this file is a canned string, so the suite stays
    // green even if a vitest upgrade stops emitting "Unhandled Error" -- the guard
    // would silently revert to false BLOCKs with no failing test to say so.
    // Pinning the declared version turns that upgrade into a test failure that
    // names exactly what to re-verify.
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    const declared = pkg.devDependencies?.vitest;
    expect(declared, 'vitest must be a declared devDependency').toBeDefined();
    const major = Number((declared ?? '').replace(/^[\^~>=\s]+/, '').split('.')[0]);
    if (major !== ASSUMED_VITEST_MAJOR) {
      throw new Error(
        `package.json declares vitest ${declared}, but the runner-error patterns in ` +
          `githooks/lib/test-failure.sh assume major ${ASSUMED_VITEST_MAJOR}. ` +
          "Re-verify the 'Unhandled Error' and 'Tests N failed' shapes against the new " +
          'reporter output, then update ASSUMED_VITEST_MAJOR and the lib comment.',
      );
    }
    // The assumption has to be stated where a maintainer edits the patterns, not
    // only in this test.
    expect(readLib()).toContain('vitest: ^1');
  });

  it('AC-454-06: the non-vitest run_tests fallback does NOT consult the guard', () => {
    // Only branches that run vitest may be excused by vitest-shaped patterns. The
    // per-adapter `run_tests` fallback runs whatever the language adapter picked
    // (jest, pytest, go test), so guarding it could excuse a real failure with a
    // marker that means something else in that output. It must keep blocking.
    //
    // The typescript fallback used to sit here as well (#498): it is reached from
    // the typescript branch, where adapters/typescript.sh runs `npx vitest run`, so
    // its output IS vitest's and it now routes through handle_test_failure like the
    // other five sites.
    const hook = readHook();
    const fallbackIndex = hook.indexOf('Genuinely non-vitest runners');
    expect(fallbackIndex).toBeGreaterThan(-1);
    // Bounded by the end of the enclosing adapter loop, so the slice cannot reach
    // past this branch into the guarded ones below.
    const loopEnd = hook.indexOf('done  # end for CURRENT_LANG', fallbackIndex);
    expect(loopEnd).toBeGreaterThan(fallbackIndex);
    const block = hook.slice(fallbackIndex, loopEnd);
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

  it('AC-473-02: a threshold-only subset run is excused by the real hook, not blocked', () => {
    // #473: Gate 5 runs only the changed test files, whose coverage can never reach
    // the global threshold, so vitest exits 1 having failed nothing. The fixture
    // stages every file, which is exactly the partial-run condition.
    const out = [
      ' Test Files  1 passed (1)',
      '      Tests  1 passed (1)',
      '% Coverage for lines (42.31%)',
      'ERROR: Coverage for lines (42.31%) does not meet global threshold (80%)',
    ].join('\n');
    const { stdout, callsFile } = runHookWithVitestOutput(out, 1);
    assertStubRan(callsFile, 'AC-473-02');
    expect(stdout).toContain('SKIPPED - coverage threshold judgement');
    expect(stdout).not.toContain('BLOCKED - Tests FAILED');
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

  it('AC-454-08: the hook really does run without errexit, which the status-capture idiom assumes', () => {
    // Gate 4's `cmd > out 2>err || PRINCIPLES_EXIT=$?` is the only form that works
    // whether or not errexit is on, and its comment claims the hook it runs inside
    // has `set -o pipefail` and NOT `set -e`. A claim about the shell options in
    // force is a claim about behaviour: adding `set -e` tomorrow would make every
    // `if ! cmd` / `cmd || rc=$?` branch in the hook behave differently, and no
    // other test here would notice. Comment lines are dropped first -- the modules
    // discuss `set -e` at length, and matching that prose is a false positive.
    const code = readHook()
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(code).toContain('set -o pipefail');
    expect(ERREXIT_OPTION.test(code)).toBe(false);
  });

  it('AC-454-08: every Gate 4 copy captures the checker status on the invoking line', () => {
    for (const rel of GATE_4_COPIES) {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      const code = src
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
      expect(code, `${rel} must capture the exit status inline`).toContain('|| PRINCIPLES_EXIT=$?');
      // The form the comment forbids: a bare call whose status is read afterwards.
      // Separated, the assignment observes the PREVIOUS command under `set -e`.
      expect(code, `${rel} reads $? on a line of its own`).not.toMatch(/^\s*PRINCIPLES_EXIT=\$\?$/m);
    }
  });

  it('AC-454-08 anti-vacuity: the two capture forms genuinely differ under errexit', () => {
    // Without this, both assertions above could be satisfied by a convention that
    // describes nothing. Run the two forms under `set -e` and show that only the
    // inline one ever records the status.
    const runForm = (body: string): string => {
      try {
        return execFileSync(bashPath(), ['-c', `set -e\n${body}`], {
          encoding: 'utf8',
        }).trim();
      } catch (err) {
        const failure = err as { stdout?: string };
        return String(failure.stdout ?? '').trim();
      }
    };
    expect(runForm('rc=0\nfalse || rc=$?\necho "rc=$rc"')).toBe('rc=1');
    expect(runForm('rc=0\nfalse\nrc=$?\necho "rc=$rc"')).not.toContain('rc=');
  });
});

