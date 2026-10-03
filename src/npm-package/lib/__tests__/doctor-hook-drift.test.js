/**
 * @test REQ-451 xp-gate doctor detects stale global hook copies
 * @intent Detect when the hooks actually executed (core.hooksPath) drift from the
 *         repository's source-of-truth githooks/, and report the direction of drift
 * @covers AC-451-01 (drift is reported with a direction)
 * @covers AC-451-02 (matching copies report no drift)
 * @covers AC-451-03 (non-repo / no-githooks contexts stay unchanged)
 *
 * Issue #451: editing githooks/pre-commit in the repo silently has no effect,
 * because core.hooksPath points at an installed copy under ~/.config/xp-gate/hooks.
 * The source-of-truth hooks are never executed on a developer machine, and nothing
 * reports how far the installed copy has drifted or in which direction.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DESCRIBE_ID = String(Math.random().toString(36).slice(2, 8));

describe('doctor hook source-of-truth drift (#451)', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;
  let originalUserProfile;
  let originalXpGateCacheDir;

  beforeAll(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalXpGateCacheDir = process.env.XP_GATE_CACHE_DIR;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `xp-gate-451-home-${DESCRIBE_ID}-`));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), `xp-gate-451-proj-${DESCRIBE_ID}-`));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterAll(() => {
    // Every path this suite touches is passed in explicitly, so there is no cwd
    // to restore (process.chdir is unavailable inside vitest workers anyway).
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.XP_GATE_CACHE_DIR = originalXpGateCacheDir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  /**
   * Build a repo-like tree with a canonical githooks/ and an installed copy.
   * The installed copy lives outside the repo, mirroring the real layout.
   */
  function scaffold({ repoPreCommit, installedPreCommit }) {
    const repoRoot = path.join(tmpProject, 'repo');
    const repoHooks = path.join(repoRoot, 'githooks');
    const installedHooks = path.join(tmpHome, '.config', 'xp-gate', 'hooks');

    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(installedHooks, { recursive: true, force: true });
    fs.mkdirSync(repoHooks, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    fs.mkdirSync(installedHooks, { recursive: true });

    fs.writeFileSync(path.join(repoHooks, 'pre-commit'), repoPreCommit);
    fs.writeFileSync(
      path.join(installedHooks, 'pre-commit'),
      installedPreCommit === undefined ? repoPreCommit : installedPreCommit
    );

    return { repoRoot, repoHooks, installedHooks };
  }

  /** require the module fresh so it picks up the patched HOME. */
  function loadDoctor() {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}lib${path.sep}doctor.js`)) delete require.cache[key];
    }
    return require('../doctor');
  }

  // -------------------------------------------------------------------------
  // AC-451-01: drift is detected and its direction reported
  // -------------------------------------------------------------------------

  it('AC-451-01: reports the installed hook is NEWER than the repo copy', () => {
    const repoBody = '#!/bin/bash\n# xp-gate pre-commit\nv1\n';
    const installedBody = '#!/bin/bash\n# xp-gate pre-commit\nv2-newer\n';
    const { repoRoot, repoHooks, installedHooks } = scaffold({
      repoPreCommit: repoBody,
      installedPreCommit: installedBody,
    });

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });

    expect(result.issues).toBeGreaterThan(0);
    const check = result.checks.find((c) => c.name.includes('pre-commit'));
    expect(check).toBeDefined();
    expect(check.status).toBe('FAIL');
    // The direction must be explicit -- "differs" alone does not tell a
    // developer whether their local gate is stricter or looser than the repo.
    expect(check.detail).toMatch(/installed.*newer|newer.*installed/i);
  });

  it('AC-451-01: reports the installed hook is OLDER than the repo copy', () => {
    const repoBody = '#!/bin/bash\n# xp-gate pre-commit\nrepo-edited\n';
    const installedBody = '#!/bin/bash\n# xp-gate pre-commit\nstale\n';
    const { repoRoot, repoHooks, installedHooks } = scaffold({
      repoPreCommit: repoBody,
      installedPreCommit: installedBody,
    });

    // mtime granularity is coarse enough that two writes in the same test tick
    // can land on the same millisecond, which would make the comparison
    // ambiguous. Pin the times explicitly so the direction is unambiguous.
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(installedHooks, 'pre-commit'), now - 3600, now - 3600);
    fs.utimesSync(path.join(repoHooks, 'pre-commit'), now, now);

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });

    expect(result.issues).toBeGreaterThan(0);
    const check = result.checks.find((c) => c.name.includes('pre-commit'));
    expect(check.status).toBe('FAIL');
    expect(check.detail).toMatch(/installed.*older|older.*installed|repo.*newer/i);
  });

  // -------------------------------------------------------------------------
  // AC-451-02: identical copies are silent
  // -------------------------------------------------------------------------

  it('AC-451-02: no issue when the installed copy matches the repo', () => {
    const body = '#!/bin/bash\n# xp-gate pre-commit\nsame\n';
    const { repoRoot, repoHooks, installedHooks } = scaffold({ repoPreCommit: body });

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });

    expect(result.issues).toBe(0);
    const check = result.checks.find((c) => c.name.includes('pre-commit'));
    expect(check.status).toBe('PASS');
  });

  // -------------------------------------------------------------------------
  // AC-451-03: no drift check outside a repo with githooks/
  // -------------------------------------------------------------------------

  it('AC-451-03: reports nothing when the project has no githooks/ directory', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-451-bare-'));
    fs.mkdirSync(path.join(bare, '.git'), { recursive: true });

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({
      repoRoot: bare,
      repoHooks: path.join(bare, 'githooks'),
      installedHooks: path.join(tmpHome, '.config', 'xp-gate', 'hooks'),
    });

    expect(result.issues).toBe(0);
    expect(result.checks).toHaveLength(0);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it('AC-451-03: reports nothing when no global copy is installed', () => {
    const { repoRoot, repoHooks } = scaffold({
      repoPreCommit: '#!/bin/bash\n# xp-gate pre-commit\nx\n',
    });

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({
      repoRoot,
      repoHooks,
      installedHooks: path.join(tmpHome, 'nowhere', 'hooks'),
    });

    expect(result.issues).toBe(0);
    expect(result.checks).toHaveLength(0);
  });

  it('AC-451-03: ignores a githooks/ that holds only adapters (consumer layout)', () => {
    // `xp-gate init` gives consumer projects githooks/adapters/ but no hook
    // files. That is not a hook source of truth, so it must not be compared --
    // otherwise every consumer project with a global install reports drift.
    const { repoRoot, repoHooks, installedHooks } = scaffold({
      repoPreCommit: '#!/bin/bash\n# xp-gate pre-commit\nx\n',
    });
    fs.rmSync(path.join(repoHooks, 'pre-commit'));
    fs.mkdirSync(path.join(repoHooks, 'adapters'), { recursive: true });
    fs.writeFileSync(path.join(repoHooks, 'adapters', 'typescript.sh'), '#!/bin/bash\n');

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });

    expect(result.issues).toBe(0);
    expect(result.checks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-451-04: only hooks that exist in BOTH places are compared
  // -------------------------------------------------------------------------

  it('compares pre-commit and pre-push, ignoring hooks absent from either side', () => {
    const { repoRoot, repoHooks, installedHooks } = scaffold({
      repoPreCommit: '#!/bin/bash\n# xp-gate pre-commit\nsame\n',
    });
    fs.writeFileSync(path.join(repoHooks, 'pre-push'), '#!/bin/bash\n# xp-gate pre-push\nrepo\n');
    fs.writeFileSync(
      path.join(installedHooks, 'pre-push'),
      '#!/bin/bash\n# xp-gate pre-push\ninstalled\n'
    );
    // post-merge exists only in the installed copy -> not a drift (the repo may
    // legitimately not carry it), and must not crash the comparison.
    fs.writeFileSync(path.join(installedHooks, 'post-merge'), '#!/bin/bash\n# xp-gate post-merge\n');

    const { diagnoseHookDrift } = loadDoctor();
    const result = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });

    const names = result.checks.map((c) => c.name);
    expect(names.some((n) => n.includes('pre-push'))).toBe(true);
    expect(names.some((n) => n.includes('post-merge'))).toBe(false);
    expect(result.issues).toBe(1);
  });

  // -------------------------------------------------------------------------
  // AC-451-02 (REQ-2): one-command sync makes the repo copy effective
  // -------------------------------------------------------------------------

  it('REQ-2: syncGlobalHooksFromRepo copies repo hooks over the installed copy', () => {
    const repoBody = '#!/bin/bash\n# xp-gate pre-commit\nrepo-authoritative\n';
    const { repoRoot, repoHooks, installedHooks } = scaffold({
      repoPreCommit: repoBody,
      installedPreCommit: '#!/bin/bash\n# xp-gate pre-commit\nstale\n',
    });

    const { syncGlobalHooksFromRepo, diagnoseHookDrift } = loadDoctor();
    const syncResult = syncGlobalHooksFromRepo({ repoRoot, repoHooks, installedHooks });

    expect(syncResult.errors).toEqual([]);
    expect(syncResult.synced).toContain('pre-commit');
    expect(fs.readFileSync(path.join(installedHooks, 'pre-commit'), 'utf8')).toBe(repoBody);

    // The drift must be gone afterwards -- that is the whole point of the sync.
    const after = diagnoseHookDrift({ repoRoot, repoHooks, installedHooks });
    expect(after.issues).toBe(0);
  });

  it('REQ-2: sync reports an error when there is no githooks/ to copy from', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-451-nogit-'));
    const { syncGlobalHooksFromRepo } = loadDoctor();

    const result = syncGlobalHooksFromRepo({
      repoRoot: bare,
      repoHooks: path.join(bare, 'githooks'),
      installedHooks: path.join(tmpHome, '.config', 'xp-gate', 'hooks'),
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/no githooks/i);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it('REQ-2: sync leaves already-identical hooks untouched', () => {
    const body = '#!/bin/bash\n# xp-gate pre-commit\nsame\n';
    const { repoRoot, repoHooks, installedHooks } = scaffold({ repoPreCommit: body });
    const installedFile = path.join(installedHooks, 'pre-commit');
    const before = fs.statSync(installedFile).mtimeMs;

    const { syncGlobalHooksFromRepo } = loadDoctor();
    const result = syncGlobalHooksFromRepo({ repoRoot, repoHooks, installedHooks });

    expect(result.synced).toEqual([]);
    expect(result.skipped).toContain('pre-commit');
    expect(fs.statSync(installedFile).mtimeMs).toBe(before);
  });
});
