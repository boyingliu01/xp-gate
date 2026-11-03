/**
 * TDD: written RED first (per AGENTS.md TDD-GATE spec).
 * @test REQ-713 Mirror checks must ignore untracked build artifacts, and a
 *   one-shot sync must bring every mirror back to byte parity
 * @intent The hook-lib mirror check failed on a machine where `githooks/lib`
 *   held an untracked `__pycache__/` — Python byte-compiled the helper during a
 *   test run. The canonical file set was otherwise byte-identical to the mirror.
 *   A false failure here costs a real fix cycle at commit time, which is exactly
 *   the rework this task set out to remove. The check must compare what git
 *   tracks, and a single command must repair drift instead of hand-copying.
 * @covers AC-713-01
 * @covers AC-713-02
 * @covers AC-713-03
 * @covers AC-713-04
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  collectMirrorPairs,
  diffTrees,
  syncMirrors,
  handleSyncMirrors,
  SYNC_EXCLUDES,
} = require('../mirror-sync');

let TMP_REPO;

beforeEach(() => {
  TMP_REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-'));
  execFileSync('git', ['init', '-q'], { cwd: TMP_REPO });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: TMP_REPO });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TMP_REPO });
});

afterEach(() => {
  fs.rmSync(TMP_REPO, { recursive: true, force: true });
});

/**
 * Write a file, creating parent directories.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/**
 * Stage everything so the files count as tracked.
 * @param {string} root
 */
function trackAll(root) {
  execFileSync('git', ['add', '-A', '-f'], { cwd: root });
}

describe('diffTrees — AC-713-01 untracked artifacts are not drift', () => {
  it('ignores an untracked build artifact in the canonical tree', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    // The artifact that broke the real check: untracked, gitignored.
    write(TMP_REPO, 'canonical/__pycache__/helper.pyc', 'binary');
    write(TMP_REPO, '.gitignore', '__pycache__/\n');
    trackAll(TMP_REPO);

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.missing).toEqual([]);
    expect(diff.differing).toEqual([]);
    expect(diff.inSync).toBe(true);
  });

  it('still reports a genuinely missing mirrored file', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'canonical/b.sh', 'echo b\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.inSync).toBe(false);
    expect(diff.missing).toContain('b.sh');
  });

  it('reports byte differences, not just missing files', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo CHANGED\n');
    trackAll(TMP_REPO);

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.inSync).toBe(false);
    expect(diff.differing).toContain('a.sh');
  });

  it('excludes declared noise directories even when they are tracked', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'canonical/node_modules/x.js', 'x');
    write(TMP_REPO, '.gitignore', 'node_modules/\n');
    trackAll(TMP_REPO);

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.inSync).toBe(true);
    expect(SYNC_EXCLUDES).toContain('node_modules');
  });
});

describe('diffTrees — per-pair excludes', () => {
  it('honours a pair-specific exclude, matching the guard script it mirrors', () => {
    // check-hook-mirror.sh:98 compares src/principles with `-x __tests__`.
    // A sync that copied tests into the package would ship test code and make
    // the guard fail on the very next run.
    write(TMP_REPO, 'canonical/lib.ts', 'export const a = 1;\n');
    write(TMP_REPO, 'canonical/__tests__/lib.test.ts', 'test\n');
    write(TMP_REPO, 'mirror/lib.ts', 'export const a = 1;\n');
    trackAll(TMP_REPO);

    const withoutExclude = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(withoutExclude.inSync).toBe(false);

    const withExclude = diffTrees(TMP_REPO, 'canonical', 'mirror', { exclude: ['__tests__'] });
    expect(withExclude.inSync).toBe(true);
    expect(withExclude.missing).toEqual([]);
  });
});

describe('collectMirrorPairs — AC-713-02 pair discovery', () => {
  it('discovers a pair only when both sides exist', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo a\n');
    write(TMP_REPO, 'src/npm-package/hooks/lib/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    const pairs = collectMirrorPairs(TMP_REPO);
    const found = pairs.find((p) => p.canonical === 'githooks/lib' && p.mirror === 'src/npm-package/hooks/lib');
    expect(found).toBeDefined();
  });

  it('does not invent a pair for a canonical tree with no mirror', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    const pairs = collectMirrorPairs(TMP_REPO);
    const found = pairs.find((p) => p.canonical === 'githooks/lib');
    expect(found).toBeUndefined();
  });
});

describe('syncMirrors — AC-713-03 repair instead of hand-copying', () => {
  it('copies a missing file and produces parity', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'canonical/b.sh', 'echo b\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/b.sh', 'echo b\n');
    trackAll(TMP_REPO);

    // Remove the mirror copy to simulate drift.
    fs.rmSync(path.join(TMP_REPO, 'mirror/b.sh'));

    const result = syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    expect(result.copied).toContain('b.sh');
    expect(diffTrees(TMP_REPO, 'canonical', 'mirror').inSync).toBe(true);
  });

  it('rewrites a differing file to match the canonical bytes', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo canonical\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo stale\n');
    trackAll(TMP_REPO);

    syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    expect(fs.readFileSync(path.join(TMP_REPO, 'mirror/a.sh'), 'utf8')).toBe('echo canonical\n');
  });

  it('is idempotent — a second run changes nothing', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    const second = syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    expect(second.copied).toEqual([]);
    expect(second.cleaned).toEqual([]);
  });

  it('supports --dry-run so the caller can preview before writing', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo fresh\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo stale\n');
    trackAll(TMP_REPO);

    const result = syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }], { dryRun: true });
    expect(result.copied).toContain('a.sh');
    // Nothing was written.
    expect(fs.readFileSync(path.join(TMP_REPO, 'mirror/a.sh'), 'utf8')).toBe('echo stale\n');
  });

  it('prunes a mirror file whose canonical source is gone', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/orphan.sh', 'echo orphan\n');
    trackAll(TMP_REPO);

    const result = syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    expect(result.cleaned).toContain('orphan.sh');
    expect(fs.existsSync(path.join(TMP_REPO, 'mirror/orphan.sh'))).toBe(false);
  });
});

describe('handleSyncMirrors — CLI contract', () => {
  let captured;
  let outSpy;

  beforeEach(() => {
    captured = [];
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    outSpy.mockRestore();
  });

  it('reports NOT MEASURABLE and exits 1 outside a repo with no pairs', () => {
    expect(handleSyncMirrors([], { root: TMP_REPO })).toBe(1);
    expect(captured.join('')).toMatch(/NOT MEASURABLE/i);
  });

  it('defaults to a dry run and does not modify files', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo canonical\n');
    write(TMP_REPO, 'src/npm-package/hooks/lib/a.sh', 'echo stale\n');
    trackAll(TMP_REPO);

    const code = handleSyncMirrors([], { root: TMP_REPO });
    // Dry run with pending work is a non-zero exit so CI can act on it.
    expect(code).toBe(1);
    expect(captured.join('')).toMatch(/Re-run with --write/);
    expect(fs.readFileSync(path.join(TMP_REPO, 'src/npm-package/hooks/lib/a.sh'), 'utf8')).toBe('echo stale\n');
  });

  it('applies the repair with --write and reports it', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo canonical\n');
    write(TMP_REPO, 'src/npm-package/hooks/lib/a.sh', 'echo stale\n');
    trackAll(TMP_REPO);

    expect(handleSyncMirrors(['--write'], { root: TMP_REPO })).toBe(0);
    expect(fs.readFileSync(path.join(TMP_REPO, 'src/npm-package/hooks/lib/a.sh'), 'utf8')).toBe('echo canonical\n');
  });
});

describe('syncMirrors — AC-713-04 safety', () => {
  it('refuses a pair whose canonical directory does not exist', () => {
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    // Guessing "canonical is empty, so wipe the mirror" would delete real files.
    expect(() => syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }])).toThrow(/canonical/i);
  });

  it('preserves the executable bit so hooks stay runnable', () => {
    write(TMP_REPO, 'canonical/hook.sh', '#!/bin/sh\necho a\n');
    fs.chmodSync(path.join(TMP_REPO, 'canonical/hook.sh'), 0o755);
    // The mirror must start as *drift*. The sync loop only touches files that
    // are `missing` or `differing`, so identical content is skipped and the mode
    // never gets rewritten. An earlier version gave both sides the same bytes,
    // so the file never entered `toWrite`; on Linux the assertion then failed
    // ("expected +0 to be truthy") while Windows skipped the whole block, which
    // is how it stayed invisible locally. The test was measuring nothing.
    write(TMP_REPO, 'mirror/hook.sh', '#!/bin/sh\necho stale\n');
    trackAll(TMP_REPO);

    const result = syncMirrors(TMP_REPO, [{ canonical: 'canonical', mirror: 'mirror' }]);
    // Prove the copy actually happened, so a green result cannot come from
    // "nothing was touched".
    expect(result.copied).toContain('hook.sh');
    expect(fs.readFileSync(path.join(TMP_REPO, 'mirror/hook.sh'), 'utf8')).toBe('#!/bin/sh\necho a\n');

    // On Windows the exec bit is not meaningful; only assert where it applies.
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(TMP_REPO, 'mirror/hook.sh')).mode;
      expect(mode & 0o111).toBeTruthy();
    }
  });
});
