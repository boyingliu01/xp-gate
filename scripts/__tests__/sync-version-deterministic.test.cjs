/**
 * @test REQ-757
 * @intent `npm ci` runs the root `prepare` hook, which runs scripts/sync-version.cjs.
 *         That script used to stamp every AGENTS.md header with the current date,
 *         HEAD sha and branch name. Measured consequence: a fresh CI checkout left
 *         32 tracked files modified during INSTALL, including
 *         `src/npm-package/principles/AGENTS.md`. The mutation job's Stryker dry
 *         run executes the whole vitest suite, whose in-tree drift guard compares
 *         that file against its canonical copy, so the job failed with
 *         `expected [ Array(1) ] to deeply equal []` on EVERY run and EVERY branch
 *         -- reading as a broken test while the writer sat in `prepare`.
 *
 *         A prepare hook must be idempotent: two runs over the same content must
 *         leave the tree byte-identical. Date/sha/branch cannot be idempotent.
 *
 *         These tests EXECUTE the script against a throwaway fixture and compare
 *         the resulting files. Asserting on the script's source text instead was
 *         the earlier version of this file, and a reviewer correctly called it
 *         vacuous: a regex over source proves nothing about behaviour, and
 *         AC-757-03 in particular ("a second run changes nothing") can only be
 *         observed by running twice.
 *
 *         The fixture is safe to run: sync-version.cjs resolves its root from
 *         `__dirname`, so a copy placed in a temp dir operates on that temp dir.
 *         (A first attempt ran the REPO's copy and the vitest worktree guard
 *         caught it writing into the real tree -- the same defect class this
 *         file exists to prevent.)
 * @covers AC-757-01, AC-757-02, AC-757-03
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-version.cjs');
// The shell sibling is the SECOND writer of the same headers, and it is the one
// cross-platform-ci.yml calls before its mirror check. Fixing only the .cjs would
// leave the defect reachable from CI, so both are pinned here.
const REAL_SHELL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-version.sh');

const HEADER = ['# FIXTURE MODULE', '', '**Generated:** 2000-01-01', '**Commit:** deadbee',
  '**Branch:** some/branch', '**Version:** 0.0.0.0', '', 'Body text that must survive.', ''].join('\n');

/**
 * Build a minimal repo the script recognises. Returns the fixture dir, its
 * AGENTS.md path, and a runner that executes the script in place.
 */
function makeFixture({ script = REAL_SCRIPT, name = 'sync-version.cjs' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-version-fixture-'));

  // A COPY of the script, so its root resolves inside the fixture, not the repo.
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(script, path.join(dir, 'scripts', name));

  fs.writeFileSync(path.join(dir, 'VERSION'), '9.9.9.9\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ version: '0.0.0' }));
  for (const rel of ['package.json', 'src/npm-package/package.json', 'plugins/dsh/package.json']) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ name: rel, version: '0.0.0' }, null, 2));
  }

  const agents = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agents, HEADER);

  return {
    dir,
    agents,
    run: () => execFileSync(process.execPath, [path.join(dir, 'scripts', name)], {
      cwd: dir, stdio: 'pipe',
    }),
    read: () => fs.readFileSync(agents, 'utf8'),
    rootPkg: () => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Convenience: build a fixture, run it `times`, return the observed output. */
function runFixture({ times = 1, ...opts } = {}) {
  const fx = makeFixture(opts);
  for (let i = 0; i < times; i++) fx.run();
  const result = { agents: fx.read(), rootPkg: fx.rootPkg() };
  fx.cleanup();
  return result;
}

describe('sync-version.cjs is idempotent (REQ-757)', () => {
  it('AC-757-01: the AGENTS.md header is not rewritten with per-run values', () => {
    const { agents } = runFixture();
    // The fixture's placeholder date/sha/branch are left EXACTLY as they were:
    // the script no longer writes those fields at all, so it neither invents new
    // values nor rewrites what is already there. Leaving the stale values
    // untouched is the only idempotent behaviour -- the operative property is
    // that the script never computes them.
    expect(agents).toContain('**Generated:** 2000-01-01');
    expect(agents).toContain('**Commit:** deadbee');
    expect(agents).toContain('**Branch:** some/branch');
    // No live value may leak in. These are what made every install dirty.
    const today = new Date().toISOString().slice(0, 10);
    expect(agents).not.toContain(`**Generated:** ${today}`);
  });

  it('AC-757-02: the version is still synced from VERSION', () => {
    const { agents, rootPkg } = runFixture();
    expect(agents).toContain('**Version:** 9.9.9.9');
    expect(rootPkg.version).toBe('9.9.9.9');
  });

  it('AC-757-03: a second run over unchanged content changes nothing', () => {
    // Same fixture, snapshotted BEFORE and AFTER a second run. Comparing two
    // SEPARATE fixtures was the earlier version of this test and it was vacuous:
    // if the volatile writes came back, two fixtures built in the same second
    // would converge on the same date/sha/branch and compare equal, so the
    // defect would pass. Only "the tree did not move" tests the property.
    const fx = makeFixture();
    try {
      fx.run();
      const afterFirst = fx.read();
      const pkgAfterFirst = JSON.stringify(fx.rootPkg());
      fx.run();
      expect(fx.read()).toBe(afterFirst);
      expect(JSON.stringify(fx.rootPkg())).toBe(pkgAfterFirst);
      // And the second run must not be a no-op that silently skipped the work:
      // the version must still be the one from VERSION.
      expect(afterFirst).toContain('**Version:** 9.9.9.9');
    } finally {
      fx.cleanup();
    }
  });

  it('AC-757-04: the shell sibling shares the same contract', () => {
    // scripts/sync-version.sh is the writer cross-platform-ci.yml calls before its
    // mirror check, so leaving it unfixed keeps the defect reachable from CI.
    //
    // The .sh cannot be copied into a temp fixture the way the .cjs can -- it
    // locates the repo with `git -C` and `find`, and its sed fallback differs per
    // platform -- so this case pins its CONTRACT rather than executing it. That is
    // weaker than AC-757-01/03 and is stated as such: what it guarantees is that
    // no per-run value is ever substituted into the header, which is exactly the
    // write that dirtied the tree. Executing both platform branches is tracked in
    // the follow-up for the sed fallback (#758).
    const src = fs.readFileSync(REAL_SHELL_SCRIPT, 'utf8');
    // Written-out values, not merely derived: a variable computed but never
    // substituted cannot dirty anything.
    const volatileWrites = [
      '**Generated:** $TODAY',
      '**Commit:** $HEAD_SHA',
      '**Branch:** $BRANCH',
    ].filter((needle) => src.includes(needle));
    expect(volatileWrites).toEqual([]);
    // Neither may it inline the value at the call site.
    expect(src).not.toMatch(/\*\*Generated:\*\*.*\$\(date/);
    // The version must survive, or the script stops doing its job.
    expect(src).toContain('**Version:** $FULL_VERSION');
  });

  it('AC-757-05: cross-platform CI no longer needs to strip headers before comparing', () => {
    // The pre-existing workaround -- sed-stripping Generated/Commit/Branch lines
    // out of the diff -- is the signature of this defect: two copies of the same
    // content differing by run conditions. With the writers fixed, the mirror
    // comparison can be plain. This is what makes the fix real rather than
    // cosmetic: the exemption exists only to hide the drift.
    const ci = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'cross-platform-ci.yml'),
      'utf8',
    );
    expect(ci).not.toContain('AGENTS.md headers vary by environment');
    expect(ci).not.toContain('[-+]\\*\\*Generated:');
  });
});
