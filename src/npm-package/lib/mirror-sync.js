/**
 * Mirror sync — bring every canonical tree / npm-package mirror back to parity.
 *
 * xp-gate keeps several trees in two places: `githooks/` is the source of truth
 * and `src/npm-package/hooks/` is the copy that ships. Four `check-*-mirror.sh`
 * scripts guard that duplication, but all four only *detect* drift; repairing it
 * is a hand-copy, and the hand-copy is where the real cost shows up: over the
 * three days to 2026-11-02, 29 of 141 commits (20.6%) touched only mirrors,
 * version stamps, AGENTS.md copies and CHANGELOG, and the mirror/sync scripts
 * were invoked 306 times.
 *
 * Two defects are fixed here:
 *
 * 1. **False drift from untracked build artifacts.** `check-hook-lib-mirror.sh`
 *    compared directory listings, so a `githooks/lib/__pycache__/` created by a
 *    Python test run made a byte-identical tree look out of sync. The set of
 *    files that matter is the set git tracks — an artifact that is not in the
 *    repository cannot be drift, because it cannot be committed.
 * 2. **No repair path.** `syncMirrors` copies what is missing, rewrites what
 *    differs, and prunes what the canonical side no longer has — idempotently,
 *    so a second run is a no-op and the operation can run on every commit
 *    without becoming a churn generator itself.
 *
 * @module mirror-sync
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Directory names that are never mirrored, even when tracked.
 *
 * A build artifact directory is machine state, not source. Copying it would
 * make the mirror differ between machines for reasons no commit explains.
 */
const SYNC_EXCLUDES = Object.freeze(['__pycache__', 'node_modules', '.git', '.DS_Store']);

/**
 * The canonical -> mirror pairs this repository maintains for whole trees.
 *
 * Declared rather than discovered recursively: a glob that silently matches
 * nothing would report "in sync" forever, which is the false green this whole
 * task exists to remove.
 *
 * Deliberately NOT including `githooks` -> `src/npm-package/hooks`: that mapping
 * is a curated *file list* (see `HOOK_MIRROR_FILES` in
 * `scripts/check-hook-mirror.sh`), not the whole directory. `githooks/` also
 * holds `__tests__/`, `AGENTS.md` and the adapters subtree, none of which ship.
 * Mirroring the directory wholesale would copy 500+ files into the npm package —
 * treating "canonical has it" as "the mirror should have it" where the project
 * never said so.
 *
 * Per-pair `exclude` mirrors the guard scripts exactly. `src/principles` already
 * excludes `__tests__` (check-hook-mirror.sh:98); a sync that copied them would
 * ship test code in the package and make the guard fail immediately afterwards.
 */
const KNOWN_PAIRS = Object.freeze([
  { canonical: 'githooks/adapters', mirror: 'src/npm-package/adapters' },
  { canonical: 'githooks/lib', mirror: 'src/npm-package/hooks/lib' },
  { canonical: 'src/principles', mirror: 'src/npm-package/principles', exclude: ['__tests__'] },
  { canonical: 'src/build-integrity', mirror: 'src/npm-package/build-integrity' },
  { canonical: 'skills', mirror: 'src/npm-package/skills' },
]);

/**
 * List files under `dir` relative to `dir`, honouring exclusions.
 *
 * @param {string} root repository root
 * @param {string} dir directory relative to root
 * @returns {string[]} relative slash-separated paths
 */
function listFiles(root, dir) {
  const abs = path.join(root, dir);
  const out = [];
  const walk = (current, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SYNC_EXCLUDES.includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(abs, '');
  return out.sort();
}

/**
 * List the files git tracks under `dir` that also exist on disk.
 *
 * The disk check matters: `git ls-files` reports the index, so a file deleted
 * from the working tree (a mirror copy removed to simulate drift, or a fix in
 * progress) is still listed. Reading it would throw ENOENT inside the diff.
 *
 * When `dir` is not inside a git repository (or git is unavailable), fall back to
 * a plain walk — the caller is then responsible for the artifact caveat, but a
 * check that crashes outside git is worse than one that reports what it sees.
 *
 * @param {string} root repository root
 * @param {string} dir directory relative to root
 * @returns {string[]}
 */
function listTrackedFiles(root, dir) {
  const normalised = dir.replace(/\\/g, '/');
  let tracked;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', dir], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    tracked = out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => p.startsWith(`${normalised}/`))
      .map((p) => p.slice(normalised.length + 1))
      .filter((p) => !p.split('/').some((seg) => SYNC_EXCLUDES.includes(seg)));
  } catch {
    return listFiles(root, dir);
  }

  // Keep only what is actually on disk; a tracked-but-deleted file must read as
  // "missing from this side", which is what the caller then repairs.
  return tracked
    .filter((p) => fs.existsSync(path.join(root, dir, p)))
    .sort();
}

/**
 * Compare a canonical tree against its mirror.
 *
 * Both sides are compared on the tracked file set so an untracked artifact in
 * either tree cannot be mistaken for drift.
 *
 * @param {string} root repository root
 * @param {string} canonical canonical dir (relative)
 * @param {string} mirror mirror dir (relative)
 * @param {{exclude?: string[]}} [options] extra directory names to skip for this pair
 * @returns {{inSync: boolean, missing: string[], differing: string[], extra: string[]}}
 */
function diffTrees(root, canonical, mirror, options = {}) {
  const exclude = options.exclude || [];
  const keep = (rel) => !rel.split('/').some((seg) => exclude.includes(seg));
  const canonicalFiles = listTrackedFiles(root, canonical).filter(keep);
  const mirrorFiles = listTrackedFiles(root, mirror).filter(keep);
  const mirrorSet = new Set(mirrorFiles);
  const canonicalSet = new Set(canonicalFiles);

  const missing = canonicalFiles.filter((f) => !mirrorSet.has(f));
  const extra = mirrorFiles.filter((f) => !canonicalSet.has(f));
  const differing = [];
  for (const rel of canonicalFiles) {
    if (!mirrorSet.has(rel)) continue;
    const a = fs.readFileSync(path.join(root, canonical, rel));
    const b = fs.readFileSync(path.join(root, mirror, rel));
    if (!a.equals(b)) differing.push(rel);
  }

  return {
    inSync: missing.length === 0 && differing.length === 0 && extra.length === 0,
    missing,
    differing,
    extra,
  };
}

/**
 * Discover the known pairs that actually exist in this repository.
 *
 * A pair is only returned when both sides are present on disk: reporting a pair
 * whose mirror does not exist yet would make `syncMirrors` create trees the
 * project never asked for.
 *
 * @param {string} root repository root
 * @returns {Array<{canonical: string, mirror: string}>}
 */
function collectMirrorPairs(root) {
  return KNOWN_PAIRS.filter(
    (pair) =>
      fs.existsSync(path.join(root, pair.canonical)) && fs.existsSync(path.join(root, pair.mirror))
  );
}

/**
 * Copy one file, preserving its executable bit.
 * @param {string} from
 * @param {string} to
 */
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  // Hooks that lose +x stop running, and the failure looks like "the gate is
  // silently skipped" rather than a permissions error.
  try {
    const mode = fs.statSync(from).mode;
    fs.chmodSync(to, mode & 0o777);
  } catch {
    // chmod is a no-op on Windows; the content copy already succeeded.
  }
}

/**
 * Bring mirrors into parity with their canonical trees.
 *
 * @param {string} root repository root
 * @param {Array<{canonical: string, mirror: string}>} [pairs] defaults to the discoverable known pairs
 * @param {{dryRun?: boolean, prune?: boolean}} [options]
 * @returns {{copied: string[], cleaned: string[], pairs: number, dryRun: boolean}}
 */
function syncMirrors(root, pairs, options = {}) {
  const dryRun = options.dryRun === true;
  const prune = options.prune !== false;
  const selected = pairs || collectMirrorPairs(root);

  const copied = [];
  const cleaned = [];

  for (const pair of selected) {
    const canonicalAbs = path.join(root, pair.canonical);
    if (!fs.existsSync(canonicalAbs) || !fs.statSync(canonicalAbs).isDirectory()) {
      // Refusing beats guessing: treating a missing canonical tree as "empty"
      // would mark every mirrored file an orphan and delete working code.
      throw new Error(`canonical directory does not exist: ${pair.canonical}`);
    }

    const diff = diffTrees(root, pair.canonical, pair.mirror, { exclude: pair.exclude });
    const toWrite = [...diff.missing, ...diff.differing];

    for (const rel of toWrite) {
      copied.push(rel);
      if (dryRun) continue;
      copyFile(path.join(root, pair.canonical, rel), path.join(root, pair.mirror, rel));
    }

    if (prune) {
      for (const rel of diff.extra) {
        cleaned.push(rel);
        if (dryRun) continue;
        try {
          fs.rmSync(path.join(root, pair.mirror, rel));
        } catch {
          // A file that vanished between listing and prune is already the goal.
        }
      }
    }
  }

  return { copied, cleaned, pairs: selected.length, dryRun };
}

/**
 * Run the `sync-mirrors` subcommand.
 *
 * Defaults to a dry run. Writing is opt-in via `--write`, because the failure
 * mode of a wrong pair declaration is silent mass overwrite — previewing costs
 * one round trip and makes the destructive path a deliberate choice.
 *
 * `root` is a parameter rather than always `process.cwd()` so tests can point at
 * a fixture; `process.chdir` is unavailable inside a vitest worker.
 *
 * @param {string[]} argv
 * @param {{root?: string}} [options]
 * @returns {number} exit code (0 when in sync / repaired; 1 when drift remains after a dry run)
 */
function handleSyncMirrors(argv, options = {}) {
  const args = argv || [];
  const write = args.includes('--write');
  const json = args.includes('--json');
  const root = options.root || process.cwd();

  const pairs = collectMirrorPairs(root);
  if (pairs.length === 0) {
    process.stdout.write('sync-mirrors: NOT MEASURABLE (no mirror pairs found — is this the xp-gate repo?)\n');
    return 1;
  }

  const before = pairs.map((pair) => ({
    pair: `${pair.canonical} -> ${pair.mirror}`,
    diff: diffTrees(root, pair.canonical, pair.mirror, { exclude: pair.exclude }),
  }));
  const drifted = before.filter((entry) => !entry.diff.inSync);

  const result = syncMirrors(root, pairs, { dryRun: !write });

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ root, write, driftedBefore: drifted.length, ...result }, null, 2)}\n`
    );
  } else {
    for (const entry of before) {
      const status = entry.diff.inSync ? 'IN SYNC' : 'DRIFT  ';
      process.stdout.write(`  ${status}  ${entry.pair}\n`);
      if (!entry.diff.inSync) {
        if (entry.diff.missing.length) process.stdout.write(`             missing: ${entry.diff.missing.slice(0, 5).join(', ')}\n`);
        if (entry.diff.differing.length) process.stdout.write(`             differing: ${entry.diff.differing.slice(0, 5).join(', ')}\n`);
        if (entry.diff.extra.length) process.stdout.write(`             extra: ${entry.diff.extra.slice(0, 5).join(', ')}\n`);
      }
    }
    if (result.copied.length === 0 && result.cleaned.length === 0) {
      process.stdout.write('All mirrors in sync.\n');
      return 0;
    }
    const verb = write ? 'Wrote' : 'Would write';
    process.stdout.write(`${verb} ${result.copied.length} file(s), prune ${result.cleaned.length}.\n`);
    if (!write) {
      process.stdout.write('Re-run with --write to apply.\n');
      return 1;
    }
  }

  return write ? 0 : drifted.length > 0 ? 1 : 0;
}

module.exports = {
  SYNC_EXCLUDES,
  KNOWN_PAIRS,
  listFiles,
  listTrackedFiles,
  diffTrees,
  collectMirrorPairs,
  syncMirrors,
  handleSyncMirrors,
};
