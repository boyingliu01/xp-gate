/**
 * @test REQ-645
 * @intent `sync-package-content.test.js` used the REAL repository root as the
 *        spawn cwd:
 *
 *          const WORKTREE_PATH = path.resolve(__dirname, '..', '..', '..', '..');
 *
 *        Four levels up from `src/npm-package/scripts/__tests__/` is the repo
 *        root, not a temp dir. The tests then ran the real sync script with
 *        `cwd: WORKTREE_PATH`, so the script's writes landed in the repository
 *        instead of a sandbox. CI's Gate 5 failed at `vitest-worktree-guard`:
 *
 *          Work tree polluted by the test run — 1 path(s) the run introduced:
 *              M src/npm-package/mock-policy/gate-m3.ts
 *
 *        The reason this is easy to miss: the pollution is CONDITIONAL. The
 *        script's writes are idempotent, so when the mirror already matches the
 *        source nothing changes and the run looks clean. It only dirties the tree
 *        when the checked-out commit happens to carry a stale mirror — which is
 *        exactly when CI is checking out a commit that the fix was supposed to
 *        validate. So it presents as "flaky, just re-run it", and re-running
 *        hides the cause while leaving the latent defect in place.
 *
 *        The guard catching it is good, but it catches the CONSEQUENCE. This file
 *        pins the CAUSE: a test may not write into the repository.
 * @covers AC-670-54, AC-670-55
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEST_FILE = path.join(
  REPO_ROOT, 'src', 'npm-package', 'scripts', '__tests__', 'sync-package-content.test.js',
);

function readSuite() {
  return fs.readFileSync(TEST_FILE, 'utf8');
}

describe('sync-package-content tests must not write into the repository (#645)', () => {
  it('AC-670-54: no test uses the repo root as a spawn cwd', () => {
    const source = readSuite();
    // The exact offending expression. `path.resolve(__dirname, '..' x4)` from the
    // test file IS the repo root -- there is no temp dir anywhere in that chain.
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((x) => /WORKTREE_PATH\s*=\s*path\.resolve\(__dirname/.test(x.line));
    expect(
      offenders,
      `tests still anchor on the real repo root:\n${offenders.map((o) => `  :${o.n} ${o.line}`).join('\n')}`,
    ).toEqual([]);
  });

  it('AC-670-55: the sync tests run against a temp worktree, not the checkout', () => {
    const source = readSuite();
    // Whatever the variable is called, the cwd handed to a spawned sync must be
    // one the test CREATED. mkdtemp is the only way to guarantee that: a path
    // built from __dirname is by construction inside the repository.
    expect(source, 'suite must create a throwaway worktree').toMatch(/mkdtemp/);
    // Every spawnSync `cwd:` must point at that temp root, never at the checkout.
    const cwdLines = source
      .split('\n')
      .filter((line) => /^\s*cwd:\s*/.test(line))
      .map((line) => line.trim());
    expect(cwdLines.length, 'expected at least one spawn cwd').toBeGreaterThan(0);
    for (const line of cwdLines) {
      expect(line, `spawn cwd escapes the sandbox: ${line}`).not.toMatch(/cwd:\s*REPO_ROOT/);
    }
  });
});
