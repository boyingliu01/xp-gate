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
 * @covers AC-713-05
 * @covers AC-713-06
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
  KNOWN_PAIRS,
  HAND_LISTED_PAIRS,
} = require('../mirror-sync');

/**
 * Directories that are mirrors of a canonical tree rather than this package's own
 * source.
 *
 * `bin/`, `lib/` and `scripts/` are the package's own code, not copies.
 *
 * `hooks/`, `plugins/` and `gates/` are supervised ELSEWHERE and are deliberately
 * omitted here rather than being reported as unsupervised:
 *   - `hooks/`  -> HOOK_MIRROR_FILES in scripts/check-hook-mirror.sh (a curated
 *                  file list, not the whole tree; same reason KNOWN_PAIRS omits it)
 *   - `plugins/`-> syncPlugins in sync-package-content.js
 *   - `gates/`  -> listed in files[] but the directory does not exist at all, so
 *                  there is nothing to compare. Left alone: removing a stale
 *                  files[] entry is a packaging change, not a mirror one.
 * Including them would make this case report three permanent failures that no
 * mirror work could ever fix.
 */
const MIRROR_DIR_CANDIDATES = [
  'adapters',
  'skills',
  'principles',
  'mutation',
  'mock-policy',
  'build-integrity',
];

/** Package-relative mirror dirs supervised by an explicit pair, not a generator. */
const HAND_LISTED_MIRRORS = HAND_LISTED_PAIRS.map((pair) =>
  pair.mirror.replace(/^src\/npm-package\//, '')
);

let TMP_REPO;

/**
 * Build the empty git repository ONCE, then copy it per case.
 *
 * Every case writes its own fixture into a pristine repo (and `afterEach`
 * deletes the tree), so each one genuinely needs a fresh repo -- but building
 * that repo means three git processes (`init` + two `config`), measured at
 * 1.4-5.0 s per case here (median ~2.6 s). Across 17 cases that was most of this
 * file's runtime.
 *
 * Copying a prepared `.git` measured 1.1 s/case less (median 1.5 s vs 2.6 s) and
 * keeps everything the cases rely on: verified after `fs.cpSync` that `git add
 * -A -f` succeeds and `git config user.email` still reports the template
 * identity. It also narrows the spread -- copying varied 0.9-2.2 s against
 * `git init`'s 1.4-5.0 s.
 *
 * No `core.hooksPath` override is needed: this file never runs `git commit`, so
 * this machine's global hooks cannot fire (the only `commit` occurrence is prose).
 */
let repoTemplate;

beforeAll(() => {
  repoTemplate = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-tpl-'));
  execFileSync('git', ['init', '-q'], { cwd: repoTemplate });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoTemplate });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoTemplate });
});

afterAll(() => {
  if (repoTemplate) fs.rmSync(repoTemplate, { recursive: true, force: true });
});

beforeEach(() => {
  TMP_REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-'));
  fs.cpSync(repoTemplate, TMP_REPO, { recursive: true });
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
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  } catch (err) {
    // Swallowing this would turn a broken fixture into a confusing assertion
    // failure further down ("expected undefined"), so rethrow with the path that
    // actually failed. The rule wants the IO handled, not hidden.
    throw new Error(`failed to write fixture ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Stage everything so the files count as tracked.
 * @param {string} root
 */
function trackAll(root) {
  execFileSync('git', ['add', '-A', '-f'], { cwd: root });
}

/**
 * Stage the canonical tree and `.gitignore`, leaving the mirror untracked.
 *
 * `trackAll` cannot be used for the generated-mirror cases: its `-f` overrides
 * `.gitignore`, so `mirror/` gets staged and the "the mirror is untracked" premise
 * disappears. Verified in a scratch repo: `git add -A -f` lists `mirror/a.sh` in
 * `git ls-files` even with `mirror/` ignored.
 *
 * @param {string} root
 * @param {string} canonical directory to track
 */
function trackCanonicalOnly(root, canonical) {
  execFileSync('git', ['add', '--', '.gitignore', canonical], { cwd: root });
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
    // The mechanism under test is the per-pair `exclude` option. It used to be
    // demonstrated with `__tests__`, but that is now a GLOBAL rule (MIRROR_EXCLUDES)
    // because the generator never copies test code for any pair -- keeping the old
    // example would assert that an undeclared `__tests__` still reports drift,
    // which is the bug this file now pins. `fixtures` stands in for a directory
    // only one pair wants to skip.
    write(TMP_REPO, 'canonical/lib.ts', 'export const a = 1;\n');
    write(TMP_REPO, 'canonical/fixtures/data.json', '{}\n');
    write(TMP_REPO, 'mirror/lib.ts', 'export const a = 1;\n');
    trackAll(TMP_REPO);

    const withoutExclude = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(withoutExclude.inSync).toBe(false);

    const withExclude = diffTrees(TMP_REPO, 'canonical', 'mirror', { exclude: ['fixtures'] });
    expect(withExclude.inSync).toBe(true);
    expect(withExclude.missing).toEqual([]);
  });

  it('does not let a pair-specific exclude re-enable the global ones', () => {
    // The lists compose. `exclude: ['fixtures']` must not silently drop
    // `__tests__` back into the comparison, or every caller that names one
    // directory reintroduces the drift this section exists to prevent.
    write(TMP_REPO, 'canonical/lib.ts', 'export const a = 1;\n');
    write(TMP_REPO, 'canonical/__tests__/lib.test.ts', 'test\n');
    write(TMP_REPO, 'mirror/lib.ts', 'export const a = 1;\n');
    trackAll(TMP_REPO);

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror', { exclude: ['fixtures'] });
    expect(diff.inSync).toBe(true);
  });
});

describe('diffTrees — P1-E a generated mirror is untracked, not missing', () => {
  it('does not report drift when the mirror tree is gitignored and byte-identical', () => {
    // P1-E step 2 took four mirror trees out of version control: prepack
    // regenerates them from canonical, so tracking them IS the duplication the
    // decision set out to remove.
    //
    // Measured after that landed: `xp-gate sync-mirrors` reported DRIFT for
    // adapters, hooks/lib, build-integrity AND skills -- the four trees the
    // generator had just written correctly. Both sides were compared on their
    // tracked file set, and a gitignored tree has none, so every canonical file
    // read as "missing from the mirror".
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'canonical/sub/b.sh', 'echo b\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/sub/b.sh', 'echo b\n');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    // Premise asserted before the verdict: if the fixture stages the mirror, the
    // case passes vacuously and stops covering what it names.
    const tracked = execFileSync('git', ['ls-files', '--', 'mirror'], {
      cwd: TMP_REPO,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.missing).toEqual([]);
    expect(diff.differing).toEqual([]);
    expect(diff.extra).toEqual([]);
    expect(diff.inSync).toBe(true);
  });

  it('still reports a byte difference inside an untracked mirror tree', () => {
    // Control. Relaxing to "the mirror is untracked, stop looking" would make the
    // case above pass and destroy the check.
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo DRIFTED\n');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.inSync).toBe(false);
    expect(diff.differing).toContain('a.sh');
  });

  it('still reports a genuinely absent file inside an untracked mirror tree', () => {
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'canonical/b.sh', 'echo b\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.inSync).toBe(false);
    expect(diff.missing).toContain('b.sh');
  });

  it('reports an orphan in an untracked mirror tree, not just missing files', () => {
    // `extra` is the verdict a disk-walk fix is most likely to drop: on the tracked
    // path it came from the mirror's own set, which is now empty.
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/gone.sh', 'echo orphan\n');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.extra).toContain('gone.sh');
    expect(diff.inSync).toBe(false);
  });

  it('keeps an untracked artifact in an untracked mirror out of the verdict', () => {
    // Both relaxations at once, which is the real repo's shape: the mirror is
    // gitignored AND holds build noise. The disk fallback must not start reporting
    // cache files as orphans -- that is the #587/#588 false failure reintroduced.
    write(TMP_REPO, 'canonical/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/a.sh', 'echo a\n');
    write(TMP_REPO, 'mirror/__pycache__/a.pyc', 'binary');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror');
    expect(diff.extra).toEqual([]);
    expect(diff.inSync).toBe(true);
  });

  it('still respects a pair-specific exclude in an untracked mirror tree', () => {
    write(TMP_REPO, 'canonical/lib.ts', 'export const a = 1;\n');
    write(TMP_REPO, 'mirror/lib.ts', 'export const a = 1;\n');
    write(TMP_REPO, 'mirror/__tests__/lib.test.ts', 'test\n');
    write(TMP_REPO, '.gitignore', 'mirror/\n');
    trackCanonicalOnly(TMP_REPO, 'canonical');

    const diff = diffTrees(TMP_REPO, 'canonical', 'mirror', { exclude: ['__tests__'] });
    expect(diff.inSync).toBe(true);
    expect(diff.extra).toEqual([]);
  });
});


describe('collectMirrorPairs — AC-713-02 pair discovery', () => {
  it('discovers a pair only when both sides exist', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo a\n');
    write(TMP_REPO, 'src/npm-package/hooks/lib/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    const pairs = collectMirrorPairs(TMP_REPO);
    const found = pairs.find((p) => p.canonical === 'githooks/lib' && p.mirror === 'src/npm-package/hooks/lib');
    // Asserted on the pair's own fields, not only on its existence: "a pair object
    // was returned" is satisfied by a pair whose mirror path is wrong, which is the
    // bug this case is named after -- the pair must be the CORRECT one.
    expect(found).toBeDefined();
    expect({ canonical: found.canonical, mirror: found.mirror }).toEqual({
      canonical: 'githooks/lib',
      mirror: 'src/npm-package/hooks/lib',
    });
  });

  it('does not invent a pair for a canonical tree with no mirror', () => {
    write(TMP_REPO, 'githooks/lib/a.sh', 'echo a\n');
    trackAll(TMP_REPO);

    const pairs = collectMirrorPairs(TMP_REPO);
    const found = pairs.find((p) => p.canonical === 'githooks/lib');
    // Asserted on the collection, not only on `found`: the bug this guards against
    // is "a canonical tree with no mirror gets paired with something", and a bare
    // `toBeUndefined()` cannot distinguish that from the whole function returning
    // nothing. Naming the discovered canonical set makes the empty result mean
    // "this pair was not invented" rather than "no pairs were found at all".
    expect(pairs.map((p) => p.canonical)).toEqual([]);
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

describe('KNOWN_PAIRS — P1-E the pair list is derived, not hand-copied', () => {
  it('every mirror directory the package ships is supervised by something', () => {
    // The real question, and the one a naive version of this case got wrong.
    //
    // Asserting "KNOWN_PAIRS contains every GENERATED_TREES row" is VACUOUS:
    // KNOWN_PAIRS is derived from GENERATED_TREES, so it holds by construction.
    // Verified by deleting the mock-policy row from the generator -- the assertion
    // still passed, which is proof it could never fail.
    //
    // What actually went wrong historically is different: `mutation` and
    // `mock-policy` were in the package's `files[]` with NO generator and NO pair,
    // so nothing ever compared them against their source. That state is
    // undetectable from inside the pair list; it needs the SHIPPED list as the
    // starting set. Every shipped mirror directory must be either generated or
    // explicitly hand-listed -- silence is the bug.
    const pkg = require('../../package.json');
    const { GENERATED_TREES } = require('../../scripts/generate-mirrors.cjs');
    // Directory-shaped `files[]` entries (a trailing slash). Loose files like
    // `gate-3.sh` and `adapter-common.sh` are mirrors of individual gates and are
    // covered by HOOK_MIRROR_FILES in check-hook-mirror.sh, not by this table.
    const shippedDirs = pkg.files
      .filter((f) => f.endsWith('/'))
      .map((f) => f.replace(/\/$/, ''))
      // Only entries that have a canonical counterpart under the repo are mirror
      // pairs; `bin/`, `lib/`, `scripts/` are this package's own source.
      .filter((d) => MIRROR_DIR_CANDIDATES.some((c) => d === c));

    const generated = new Set(GENERATED_TREES.map((t) => t.mirror));
    const handListed = new Set(HAND_LISTED_MIRRORS);
    const unsupervised = shippedDirs.filter((d) => !generated.has(d) && !handListed.has(d));
    expect(unsupervised).toEqual([]);
  });

  it('declares no pair whose mirror the package does not ship', () => {
    // The other direction. A pair pointing at a directory absent from `files[]`
    // would check something that never reaches a consumer, which reads as coverage
    // without being any.
    const pkg = require('../../package.json');
    // KNOWN_PAIRS holds REPO-relative paths; files[] holds PACKAGE-relative ones.
    const PRE = 'src/npm-package/';
    // files[] entries carry a trailing slash ('adapters/'). Comparing the raw
    // strings reports EVERY pair as unshipped -- which is exactly how this case
    // failed on its first version, and why the check is written against the
    // normalised entry rather than trusting the two lists to be spelled alike.
    const shipped = (p) =>
      p.startsWith(PRE) &&
      pkg.files.some((f) => {
        const entry = f.replace(/\/$/, '');
        const rel = p.slice(PRE.length);
        return rel === entry || rel.startsWith(`${entry}/`);
      });
    for (const pair of KNOWN_PAIRS) {
      expect(shipped(pair.mirror)).toBe(true);
    }
  });

  it('has no duplicate canonical tree', () => {
    const canonicals = KNOWN_PAIRS.map((p) => p.canonical);
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });
});
