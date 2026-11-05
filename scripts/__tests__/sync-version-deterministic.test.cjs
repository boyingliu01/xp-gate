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
 * Build a minimal repo the script recognises, run it `times`, and return the
 * resulting AGENTS.md plus the package.json contents it synced.
 */
function runFixture({ times = 1, script = REAL_SCRIPT, name = 'sync-version.cjs' } = {}) {
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

  for (let i = 0; i < times; i++) {
    execFileSync(process.execPath, [path.join(dir, 'scripts', name)], {
      cwd: dir, stdio: 'pipe',
    });
  }

  const result = {
    agents: fs.readFileSync(agents, 'utf8'),
    rootPkg: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')),
  };
  fs.rmSync(dir, { recursive: true, force: true });
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
    const once = runFixture({ times: 1 });
    const twice = runFixture({ times: 2 });
    // This is the property that makes `npm ci` safe: the install step must not
    // leave the tree different from what was committed.
    expect(twice.agents).toBe(once.agents);
    expect(twice.rootPkg.version).toBe(once.rootPkg.version);
  });

  it('AC-757-04: the shell sibling writes no per-run values either', () => {
    // scripts/sync-version.sh is the writer cross-platform-ci.yml runs before its
    // mirror check. Leaving it unfixed would keep the defect reachable from CI
    // even after the .cjs is corrected -- the reviewer's second finding.
    const src = fs.readFileSync(REAL_SHELL_SCRIPT, 'utf8');
    // Written-out values, not merely derived: a variable computed but never
    // substituted cannot dirty anything.
    const volatileWrites = [
      '**Generated:** $TODAY',
      '**Commit:** $HEAD_SHA',
      '**Branch:** $BRANCH',
    ].filter((needle) => src.includes(needle));
    expect(volatileWrites).toEqual([]);
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
