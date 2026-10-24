/**
 * @test REQ-599
 * @intent #566 was a hook that existed on exactly one machine and in no commit:
 *         the installed `~/.config/xp-gate/hooks/pre-push` carried a local
 *         `_score()` helper plus `gates_skipped` that no branch had ever held,
 *         and `xp-gate doctor --sync-hooks` replaced it without a word. The repo
 *         side then looked correct and the only copy of that work was gone.
 *
 *         doctor already REFUSES to overwrite a file whose content diverges, and
 *         says "there is no automatic backup ... nothing records the previous
 *         version". That refusal covers divergence; it does not cover the
 *         legitimate overwrites that also destroy a previous version -- `--force`,
 *         and files that differ only in whitespace. So the loss #566 describes
 *         was still possible after the refusal landed.
 *
 *         These cases assert that every overwrite keeps the previous version,
 *         in a `backups/` directory beside the installed hooks (not in the user's
 *         work tree), timestamped so a later sync cannot destroy an earlier
 *         backup.
 * @covers AC-599-13
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DESCRIBE_ID = String(Math.random().toString(36).slice(2, 8));

describe('doctor --sync-hooks keeps the previous version (#566)', () => {
  let tmpHome;
  let originalHome;
  let originalUserProfile;

  beforeAll(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `xp-gate-566-home-${DESCRIBE_ID}-`));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function loadDoctor() {
    return require('../doctor');
  }

  /**
   * Build a repo-like githooks/ plus an installed hooks dir.
   * @param {{installedPrePush?: string}} [opts] content for the installed pre-push
   */
  function makeLayout(opts = {}) {
    const root = fs.mkdtempSync(path.join(tmpHome, `layout-${DESCRIBE_ID}-`));
    const repoRoot = path.join(root, 'repo');
    const repoHooks = path.join(repoRoot, 'githooks');
    const installedHooks = path.join(root, 'installed-hooks');
    fs.mkdirSync(repoHooks, { recursive: true });
    fs.mkdirSync(installedHooks, { recursive: true });

    // The canonical hook carries the xp-gate signature doctor looks for.
    fs.writeFileSync(
      path.join(repoHooks, 'pre-push'),
      '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# Pre-push Hook — 8 gates: Gate 10\necho canonical\n',
    );
    if (opts.installedPrePush !== undefined) {
      fs.writeFileSync(path.join(installedHooks, 'pre-push'), opts.installedPrePush);
    }
    return { root, repoRoot, repoHooks, installedHooks };
  }

  it('AC-599-13: overwriting an existing hook keeps a copy of the previous version', () => {
    const { repoHooks, installedHooks } = makeLayout({
      installedPrePush: '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# GHOST LOCAL EDIT\n',
    });

    const { syncGlobalHooksFromRepo } = loadDoctor();
    const result = syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    expect(result.synced).toContain('pre-push');
    expect(result.backups.length).toBeGreaterThan(0);

    const backup = result.backups.find((b) => path.basename(b).startsWith('pre-push.'));
    expect(backup).toBeTruthy();
    expect(fs.readFileSync(backup, 'utf8')).toContain('GHOST LOCAL EDIT');
  });

  it('AC-599-13: the backup lives beside the installed hooks, not in a work tree', () => {
    const { repoRoot, repoHooks, installedHooks } = makeLayout({
      installedPrePush: '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# local only\n',
    });

    const { syncGlobalHooksFromRepo } = loadDoctor();
    syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    const backupsDir = path.join(installedHooks, 'backups');
    expect(fs.existsSync(backupsDir)).toBe(true);
    // Nothing was written into the repository: a backup must not become the
    // user's problem to clean out of `git status`.
    const repoEntries = fs.readdirSync(repoRoot).sort();
    expect(repoEntries).toEqual(['githooks']);
  });

  it('AC-599-13: installing into an empty hooks dir creates no backup', () => {
    // Nothing was overwritten, so there is nothing to keep -- a backup directory
    // of empty files would be noise that trains the operator to ignore it.
    const { repoHooks, installedHooks } = makeLayout();

    const { syncGlobalHooksFromRepo } = loadDoctor();
    const result = syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    expect(result.synced).toContain('pre-push');
    expect(result.backups).toEqual([]);
    expect(fs.existsSync(path.join(installedHooks, 'backups'))).toBe(false);
  });

  it('AC-599-13: two successive overwrites keep both previous versions', () => {
    // A timestamped name is the point: the second sync must not destroy the
    // backup the first sync made, or the work it was protecting is lost anyway.
    const { repoHooks, installedHooks } = makeLayout({
      installedPrePush: '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# EDIT ONE\n',
    });
    const { syncGlobalHooksFromRepo } = loadDoctor();
    syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    fs.writeFileSync(path.join(installedHooks, 'pre-push'), '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# EDIT TWO\n');
    const second = syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    const backupsDir = path.join(installedHooks, 'backups');
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('pre-push.'));
    expect(files.length).toBe(2);
    const contents = files.map((f) => fs.readFileSync(path.join(backupsDir, f), 'utf8'));
    expect(contents.some((c) => c.includes('EDIT ONE'))).toBe(true);
    expect(contents.some((c) => c.includes('EDIT TWO'))).toBe(true);
    expect(second.backups.length).toBeGreaterThan(0);
  });

  it('AC-599-13: an identical file is not re-copied and leaves no backup', () => {
    const canonical = '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# Pre-push Hook — 8 gates: Gate 10\necho canonical\n';
    const { repoHooks, installedHooks } = makeLayout({ installedPrePush: canonical });

    const { syncGlobalHooksFromRepo } = loadDoctor();
    const result = syncGlobalHooksFromRepo({ repoHooks, installedHooks });

    expect(result.synced).not.toContain('pre-push');
    expect(result.skipped).toContain('pre-push');
    expect(result.backups).toEqual([]);
  });

  it('AC-599-13: shared lib/ libraries are backed up before being replaced too', () => {
    // The lib/ channel overwrites unconditionally unless it refuses, so it is the
    // channel most likely to erase machine-only hardening.
    const { repoRoot, repoHooks, installedHooks } = makeLayout();
    fs.mkdirSync(path.join(repoHooks, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(repoHooks, 'lib', 'coverage-total.sh'), 'echo canonical-lib\n');
    fs.mkdirSync(path.join(installedHooks, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(installedHooks, 'lib', 'coverage-total.sh'), 'echo LOCAL-LIB-EDIT\n');

    // Force, because otherwise the divergence guard refuses before the overwrite.
    const { syncGlobalHooksFromRepo } = loadDoctor();
    const result = syncGlobalHooksFromRepo({ repoRoot, repoHooks, installedHooks, force: true });

    const backup = result.backups.find((b) => path.basename(b).startsWith('coverage-total.sh.'));
    expect(backup).toBeTruthy();
    expect(fs.readFileSync(backup, 'utf8')).toContain('LOCAL-LIB-EDIT');
  });

  it('AC-599-13: two syncs inside the same millisecond both keep their version', () => {
    // The CI failure that motivated this case: "two successive overwrites keep
    // both previous versions" passed locally and failed on a fast runner with
    // `expected 1 to be 2`. The stamp has millisecond resolution, so when two
    // syncs land in the SAME millisecond they compute the SAME backup name and
    // the second copy silently destroys the first. Local runs usually straddled
    // a millisecond boundary and never saw it.
    //
    // Pin Date so the collision is guaranteed rather than hoped for: asserting a
    // bug that only appears under a timing race is how the suite went green while
    // the defect shipped.
    const { repoHooks, installedHooks } = makeLayout({
      installedPrePush: '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# SAME-MS-ONE\n',
    });
    const { syncGlobalHooksFromRepo } = loadDoctor();

    // Freeze ONLY the clock the stamp reads. Nothing else is replaced: an earlier
    // draft overrode Date.prototype.toISOString, which made the backup helper
    // recurse into itself and threw "Maximum call stack size exceeded" -- the
    // case then appeared to fail for a reason that had nothing to do with backups.
    const RealDate = Date;
    const frozen = 1767225600123; // any instant; only that it never advances
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(frozen);
        else super(...args);
      }
      static now() {
        return frozen;
      }
    };
    try {
      syncGlobalHooksFromRepo({ repoHooks, installedHooks, force: true });

      fs.writeFileSync(
        path.join(installedHooks, 'pre-push'),
        '#!/usr/bin/env bash\n# XP-Gate Pre-Push Hook\n# SAME-MS-TWO\n',
      );
      syncGlobalHooksFromRepo({ repoHooks, installedHooks, force: true });
    } finally {
      global.Date = RealDate;
    }

    const backupsDir = path.join(installedHooks, 'backups');
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('pre-push.'));
    expect(files.length).toBe(2);

    const contents = files.map((f) => fs.readFileSync(path.join(backupsDir, f), 'utf8'));
    expect(contents.some((c) => c.includes('SAME-MS-ONE'))).toBe(true);
    expect(contents.some((c) => c.includes('SAME-MS-TWO'))).toBe(true);
  });
});
