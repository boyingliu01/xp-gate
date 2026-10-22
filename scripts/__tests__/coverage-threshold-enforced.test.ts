/**
 * @test REQ-562 coverage threshold enforcement
 * @intent The coverage gate must actually block a run whose coverage is below
 *         the configured threshold. #555 unified the *number* three sources of
 *         truth disagreed about, but never asked whether the number is enforced
 *         at all: `vitest.config.ts` declared `thresholds.global = {...}` — the
 *         vitest **2.x** shape — while the repo pins vitest **1.6.1**, whose
 *         `coverage.d.ts` types the field as a FLAT
 *         `Partial<Record<Threshold, number>>`. An unknown nested key is
 *         silently ignored, so a 60.08% run against a declared 80% floor exits
 *         0, and AGENTS.md's "coverage <80% BLOCK" has never fired once.
 *
 *         AC-COV-01/02 are a CONTROLLED PAIR: identical fixture, identical
 *         unreachable thresholds, identical real coverage — the ONLY difference
 *         is the config shape. One blocks, one does not. That is what makes the
 *         defect attributable to the shape rather than to anything else.
 * @covers AC-COV-01, AC-COV-02, AC-COV-03
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// This file lives at scripts/__tests__/, so the repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VITEST_BIN = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const REPO_NODE_MODULES = path.join(REPO_ROOT, 'node_modules');

/**
 * Threshold numbers used by both halves of the controlled pair. Unreachable on
 * purpose: the fixture's `src/uncovered.ts` is imported by nothing, so real
 * line coverage lands near 14% and can never satisfy 100.
 */
const UNREACHABLE = { lines: 100, statements: 100, functions: 100, branches: 100 };

let FIXTURE_ROOT: string;

/**
 * Build a throwaway vitest project in the OS temp dir.
 *
 * The fixture contains one fully-tested module and one module nothing imports,
 * which is what drags real coverage down to a level no threshold here can be
 * satisfied by. `node_modules` is a directory junction onto the repo's own, so
 * `vitest`/`@vitest/coverage-v8` resolve without installing anything: a bare
 * temp dir cannot resolve `vitest/config` and the run dies before coverage is
 * even measured.
 *
 * Isolation matters for a second reason: Gate 5 runs vitest WITH coverage over
 * changed test files, so a test that spawns its own in-repo coverage run makes
 * two vitest processes fight over `coverage/.tmp` (seen as
 * `ENOENT: coverage/.tmp/coverage-0.json`). A temp project with its own
 * `coverage/` removes the shared state entirely.
 *
 * @param name - subdirectory name, one per shape under test
 * @param thresholdsSource - the `thresholds:` entry, as TS source
 * @returns absolute path to the fixture project
 */
/**
 * Write one file inside the fixture, creating parent dirs as needed.
 *
 * Every write goes through here so the whole fixture has a single error-handling
 * boundary: a failure to lay the project down must abort the setup loudly rather
 * than let the coverage assertions run against a half-built tree and pass
 * vacuously.
 *
 * @param dir - fixture root
 * @param rel - path relative to the fixture root
 * @param content - file body
 */
function writeFixtureFile(dir: string, rel: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fixture setup failed writing ${rel}: ${msg}`);
  }
}

/**
 * Fully-tested module: its line coverage is what the fixture can guarantee.
 * @returns module source
 */
function testedModuleSource(): string {
  return ['export function add(a: number, b: number): number {', '  return a + b;', '}', ''].join(
    '\n'
  );
}

/**
 * Module nothing imports. This is the uncovered surface that drags the
 * fixture's real coverage down, which is what makes an unreachable threshold
 * meaningful.
 * @returns module source
 */
function uncoveredModuleSource(): string {
  return [
    'export function neverCalled(a: number): number {',
    '  if (a > 0) {',
    '    return a * 2;',
    '  }',
    '  return -a;',
    '}',
    '',
  ].join('\n');
}

/**
 * Test file pairing with {@link testedModuleSource}.
 * @returns test source
 */
function pairedTestSource(): string {
  return [
    "import { describe, test, expect } from 'vitest';",
    "import { add } from './math';",
    '',
    "describe('add', () => {",
    "  test('adds', () => {",
    '    expect(add(1, 2)).toBe(3);',
    '  });',
    '});',
    '',
  ].join('\n');
}

/**
 * Fixture vitest config, parameterised by the `thresholds:` entry under test.
 *
 * Exported as a plain object, NOT via `defineConfig` from 'vitest/config':
 * importing that in a temp dir fails module resolution before the config is
 * ever read, which would make every assertion here vacuous.
 *
 * @param thresholdsSource - the `thresholds:` entry, as TS source
 * @returns config source
 */
function fixtureConfigSource(thresholdsSource: string): string {
  return [
    'export default {',
    '  test: {',
    '    globals: true,',
    "    environment: 'node',",
    "    include: ['src/**/*.test.ts'],",
    '    coverage: {',
    "      provider: 'v8',",
    "      include: ['src/**/*.ts'],",
    "      exclude: ['**/*.test.ts'],",
    "      reporter: ['json-summary'],",
    thresholdsSource,
    '    },',
    '  },',
    '};',
    '',
  ].join('\n');
}

/**
 * Build a throwaway vitest project in the OS temp dir.
 *
 * The fixture contains one fully-tested module and one module nothing imports,
 * which drags real coverage below anything the thresholds here can accept.
 * `node_modules` is a directory junction onto the repo's own so
 * `vitest`/`@vitest/coverage-v8` resolve without installing anything: a bare
 * temp dir cannot resolve `vitest/config` and the run dies before coverage is
 * measured.
 *
 * Isolation matters for a second reason: Gate 5 runs vitest WITH coverage over
 * changed test files, so a test that spawns its own in-repo coverage run makes
 * two vitest processes fight over `coverage/.tmp` (seen as
 * `ENOENT: coverage/.tmp/coverage-0.json`). A temp project with its own
 * `coverage/` removes the shared state entirely.
 *
 * @param name - subdirectory name, one per shape under test
 * @param thresholdsSource - the `thresholds:` entry, as TS source
 * @returns absolute path to the fixture project
 */
function writeFixture(name: string, thresholdsSource: string): string {
  const dir = path.join(FIXTURE_ROOT, name);

  writeFixtureFile(dir, 'src/math.ts', testedModuleSource());
  writeFixtureFile(dir, 'src/math.test.ts', pairedTestSource());
  writeFixtureFile(dir, 'src/uncovered.ts', uncoveredModuleSource());
  writeFixtureFile(
    dir,
    'package.json',
    JSON.stringify({ name: `cov-fixture-${name}`, type: 'module', private: true }, null, 2)
  );
  writeFixtureFile(dir, 'vitest.config.ts', fixtureConfigSource(thresholdsSource));

  // Junction onto the repo's node_modules. `fs.symlinkSync` with 'junction'
  // works unprivileged; `mklink /J` would need a shell and is not portable.
  try {
    fs.symlinkSync(REPO_NODE_MODULES, path.join(dir, 'node_modules'), 'junction');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fixture setup failed linking node_modules: ${msg}`);
  }

  return dir;
}

/**
 * Run vitest against a fixture and capture its verdict.
 * @param cwd - fixture project root
 * @returns exit status plus combined stdout/stderr
 */
function runFixtureCoverage(cwd: string): { status: number | null; output: string } {
  const res = spawnSync(process.execPath, [VITEST_BIN, 'run', '--coverage', '--reporter=dot'], {
    cwd,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, XP_GATE_SKIP_WORKTREE_GUARD: '1' },
  });
  return {
    status: res.status,
    output: String(res.stdout || '') + String(res.stderr || ''),
  };
}

beforeAll(() => {
  FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-threshold-'));
});

afterAll(() => {
  // Remove each junction before the tree, so the recursive delete cannot walk
  // into the repo's node_modules through the link.
  for (const entry of fs.readdirSync(FIXTURE_ROOT)) {
    const link = path.join(FIXTURE_ROOT, entry, 'node_modules');
    if (fs.existsSync(link)) fs.unlinkSync(link);
  }
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('coverage threshold enforcement', () => {
  test('AC-COV-01: the FLAT shape blocks a below-threshold run', () => {
    // CONTROL. This is the shape vitest 1.6.1 actually reads, and it must
    // block. If this ever passes silently, the enforcement plumbing itself is
    // broken and AC-COV-02's result proves nothing.
    const dir = writeFixture('flat', `      thresholds: ${JSON.stringify(UNREACHABLE)},`);

    const { status, output } = runFixtureCoverage(dir);

    expect(
      output,
      'expected vitest to print a threshold violation for the flat shape'
    ).toMatch(/does not meet global threshold/i);
    expect(status, 'a below-threshold run under the flat shape must exit non-zero').not.toBe(0);
  }, 300_000);

  test('AC-COV-02: the nested `global` shape is silently ignored — the SAME run passes', () => {
    // DEFECT. Identical fixture, identical unreachable numbers, identical real
    // coverage; only the shape differs. Under vitest 1.6.1 the unknown nested
    // key is dropped without a warning and the run exits 0.
    const dir = writeFixture(
      'nested',
      `      thresholds: { global: ${JSON.stringify(UNREACHABLE)} },`
    );

    const { status, output } = runFixtureCoverage(dir);

    // Anti-vacuity: a config that failed to load would also "not block".
    //
    // Check the ARTIFACT, not a log line. `--reporter=dot` does not reliably print
    // "Coverage enabled with v8" — under vitest 1.6.1 on Linux CI it is absent even
    // though coverage was measured, which turned this anti-vacuity guard into a
    // failure with "Unexpected end of JSON input"/no-match while the run itself was
    // fine (#586). The coverage summary the run produces is the actual evidence
    // that measurement happened, and it is written regardless of reporter.
    const summaryPath = path.join(dir, 'coverage', 'coverage-summary.json');
    expect(
      fs.existsSync(summaryPath),
      'the fixture must have actually measured coverage; a config-load failure ' +
        'would make this assertion meaningless (no coverage summary was written)'
    ).toBe(true);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
      total?: { lines?: { pct?: number } };
    };
    expect(
      typeof summary.total?.lines?.pct,
      'the coverage summary must carry a real measured percentage'
    ).toBe('number');

    expect(
      status,
      'vitest 1.6.1 ignores `thresholds.global` — this test documents the ' +
        'defect (issue #561). If it ever starts blocking, the shape has become ' +
        'supported and this test should be DELETED, not "fixed".'
    ).toBe(0);
  }, 300_000);

  test('AC-COV-03: the repo config uses the flat shape vitest 1.6.1 reads', () => {
    // Regression guard for the shipped config. Read the source text rather than
    // importing it: importing would execute the config and hand back an object
    // that cannot distinguish "declared" from "understood".
    const configPath = path.join(REPO_ROOT, 'vitest.config.ts');
    const raw = fs.readFileSync(configPath, 'utf8');

    // Strip comments FIRST. The config deliberately explains the defect in a
    // comment (`the `thresholds: { global: {...} }` shape is vitest 2.x`), and
    // a naive scan matches that prose instead of the live code — which is how
    // this test first failed against a correct config.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const match = text.match(/thresholds\s*:\s*\{[\s\S]*?\n\s*\},?/);
    expect(match, 'vitest.config.ts must declare a thresholds block').toBeTruthy();

    const block = match![0];
    expect(
      block,
      'vitest 1.6.1 types coverage.thresholds as a FLAT ' +
        'Partial<Record<Threshold, number>>; a nested `global: {...}` object is ' +
        'ignored without a warning, turning the whole coverage gate into a no-op ' +
        '(issue #561)'
    ).not.toMatch(/\bglobal\s*:/);

    for (const metric of ['lines', 'statements', 'functions', 'branches']) {
      expect(block, `thresholds must set ${metric} directly (flat shape)`).toMatch(
        new RegExp(`\\b${metric}\\s*:\\s*\\d+`)
      );
    }
  });
});
