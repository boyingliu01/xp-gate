/**
 * @test REQ-604
 * @intent A deploy that overwrites an installed hook must leave a record of what
 *         it replaced and which version did it.
 *
 *         #583: `xp-gate doctor --sync-hooks` overwrote `~/.config/xp-gate/hooks/
 *         pre-commit` three times in one day, each time silently. A downstream
 *         that had hardened its hooks (and kept the vendored copy in sync, with a
 *         consistency test guarding it) discovered it only by running its own
 *         SHA256 comparison. The consequences were not cosmetic: one overwrite
 *         reverted a fixed fail-open in Gate 5's coverage arm, so commits started
 *         passing on unmeasurable coverage again — a defect that had already been
 *         filed, fixed and tested.
 *
 *         #566 added the backup, which makes the damaged file recoverable. It
 *         does not answer the question the downstream actually has: "was my patch
 *         eaten, and by which version?" A directory of timestamped `.bak` files
 *         can be read, but only by someone who already suspects an overwrite.
 *
 *         So the invariant here is narrow and provable without a network, a
 *         registry, or a real install: when sync-hooks overwrites file X, one
 *         line is appended to a deploy log naming X, the version that did it, and
 *         the backup that holds the previous content. Nothing more.
 *
 *         Deliberately NOT in scope (the issue's option 2): refusing to overwrite
 *         a locally-modified hook without `--force`. That changes the deploy
 *         contract for every consumer and needs a product decision, not a bug fix.
 * @covers AC-604-01, AC-604-02, AC-604-03
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncGlobalHooksFromRepo } = require('../doctor.js');

function writeHook(dir, name, body) {
  const p = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, body, { mode: 0o755 });
  } catch (err) {
    // A fixture that cannot create its file must fail the case loudly, not leave
    // a partially-built directory for the assertions to interpret (#583).
    throw new Error(`fixture setup failed writing ${p}: ${err.message}`);
  }
  return p;
}

describe('REQ-604: sync-hooks leaves a deploy record', () => {
  let tmp;
  let repoHooks;
  let installedHooks;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-deploy-log-'));
    repoHooks = path.join(tmp, 'repo', 'githooks');
    installedHooks = path.join(tmp, 'installed', 'hooks');
    fs.mkdirSync(installedHooks, { recursive: true });
    // The banner line is the signature doctor uses to recognise an xp-gate hook.
    writeHook(repoHooks, 'pre-commit', '#!/bin/bash\n# XP-GATE QUALITY GATES v0.31.1.0\necho new\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('AC-604-01: an overwrite appends one line naming the file, the version and the backup', () => {
    // The downstream's hardened copy: different from upstream, so it IS replaced.
    writeHook(installedHooks, 'pre-commit', '#!/bin/bash\n# XP-GATE QUALITY GATES v0.30.0.0\n# downstream hardening\necho old\n');

    const result = syncGlobalHooksFromRepo({ repoHooks, installedHooks, version: '0.31.1.0' });

    expect(result.errors).toEqual([]);
    expect(result.synced).toContain('pre-commit');

    const logPath = path.join(installedHooks, 'deploy.log');
    expect(fs.existsSync(logPath)).toBe(true);

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const entry = lines.find((l) => l.includes('pre-commit'));
    expect(entry, `deploy log must name pre-commit, got:\n${lines.join('\n')}`).toBeTruthy();

    // The three facts the downstream needs, all in that one line: which file,
    // which version replaced it, and where the previous content went.
    expect(entry).toMatch(/pre-commit/);
    expect(entry).toMatch(/0\.31\.1\.0/);
    expect(entry, `names the backup holding the old content, got: ${entry}`).toMatch(/\.bak/);
  });

  it('AC-604-02: an unchanged file produces no deploy entry', () => {
    // Identical content: sync skips it, so there is nothing to report. A log that
    // records non-events is noise, and noise is what makes real overwrites
    // invisible.
    writeHook(installedHooks, 'pre-commit', '#!/bin/bash\n# XP-GATE QUALITY GATES v0.31.1.0\necho new\n');

    const result = syncGlobalHooksFromRepo({ repoHooks, installedHooks, version: '0.31.1.0' });
    expect(result.skipped).toContain('pre-commit');

    const logPath = path.join(installedHooks, 'deploy.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).not.toContain('pre-commit');
    }
  });

  it('AC-604-03: repeated overwrites accumulate rather than replacing history', () => {
    // The whole point of the log is answering "how many times, and when" — one
    // day saw three overwrites. Overwriting the log each run would destroy
    // exactly the evidence the downstream needs.
    writeHook(installedHooks, 'pre-commit', '#!/bin/bash\n# XP-GATE QUALITY GATES v0.30.0.0\necho v1\n');
    syncGlobalHooksFromRepo({ repoHooks, installedHooks, version: '0.31.1.0' });

    writeHook(installedHooks, 'pre-commit', '#!/bin/bash\n# XP-GATE QUALITY GATES v0.30.0.0\necho v1-patched-by-downstream\n');
    syncGlobalHooksFromRepo({ repoHooks, installedHooks, version: '0.31.1.0' });

    const logPath = path.join(installedHooks, 'deploy.log');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l.includes('pre-commit'));
    expect(lines).toHaveLength(2);
  });
});
