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
 * The checkout root, derived from this file's location rather than from the
 * caller's cwd: this module is invoked both from the repo root and from an
 * installed copy, and `process.cwd()` differs between them.
 *
 * `src/npm-package/lib/` -> three levels up.
 */
const REPO_ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

/**
 * Directory names that are never mirrored, even when tracked.
 *
 * A build artifact directory is machine state, not source. Copying it would
 * make the mirror differ between machines for reasons no commit explains.
 */
const SYNC_EXCLUDES = Object.freeze(['__pycache__', 'node_modules', '.git', '.DS_Store']);

/**
 * Directory names never mirrored into the package, for every pair.
 *
 * `__tests__` belongs here rather than in a per-pair `exclude`, because the
 * decision is global and already made once: `sync-package-content.js` puts
 * `__tests__` in its `SKIP_DIRS`, so no mirror ever receives test code.
 *
 * Declaring it per-pair made the same rule exist twice, and the copies drifted.
 * Measured: `skills/sprint-flow/__tests__/` is tracked source, the generator
 * correctly does not copy it, and `sync-mirrors` reported the whole pair as DRIFT
 * on any checkout that has that directory. `src/principles` declared the exclude
 * and stayed green; `skills` and `src/build-integrity` did not declare it and went
 * red. One rule, one place.
 */
const MIRROR_EXCLUDES = Object.freeze([...SYNC_EXCLUDES, '__tests__']);

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
 * Per-pair `exclude` stays available for a rule that genuinely applies to one
 * pair only. `__tests__` is not one of those -- see `MIRROR_EXCLUDES`.
 *
 * P1-E step 3: the pairs a generator owns are now DERIVED from that generator
 * instead of being listed again here. Two hand-written lists had already drifted:
 * this table carried five pairs and `generate-mirrors.cjs` carried four (it did
 * not know about `principles`), and neither knew about `mutation` or
 * `mock-policy`, which shipped in the package with no generator at all. A pair
 * that exists in one list and not the other is invisible to exactly the check
 * meant to catch it.
 *
 * A generator tree that cannot be resolved is skipped rather than thrown: this
 * module also runs from an installed copy, where the repository layout it would
 * read does not exist. Skipping reproduces the old hand-listed behaviour for that
 * pair instead of crashing a diagnostic command.
 */
function generatedPairs() {
  let trees;
  try {
    trees = require('../scripts/generate-mirrors.cjs').GENERATED_TREES;
  } catch {
    // Not running from a checkout: an installed package ships `lib/` but NOT the
    // `scripts/` tree this module reads its pairs from. Returning [] is correct
    // there -- the canonical trees (`githooks/`, `src/`) are not installed either,
    // so there is nothing to compare and no detection capability is lost.
    //
    // This must stay distinguishable from "the generator exists but yielded
    // nothing", which would be a broken checkout. `assertPairsResolved` below
    // makes that case loud instead of silently reporting zero drift.
    return [];
  }
  if (!Array.isArray(trees)) return [];
  const repoRelative = (abs) => path.relative(REPO_ROOT_DIR, abs).split(path.sep).join('/');
  return trees.map((tree) => ({
    canonical: repoRelative(tree.canonical),
    mirror: `src/npm-package/${tree.mirror}`,
  }));
}

/**
 * Pairs supervised by something OTHER than `GENERATED_TREES`.
 *
 * Empty as of P1-E step 4. `principles` was the last entry: it had a separate
 * generation path and was listed here by hand, then moved into the generator once
 * the workstream editing it in place landed. Keeping the named empty list rather
 * than deleting it gives the next genuinely non-generatable pair an obvious home,
 * instead of someone hand-adding it back to `KNOWN_PAIRS` and recreating the
 * two-lists-that-disagree problem this file just removed.
 */
const HAND_LISTED_PAIRS = Object.freeze([]);

const KNOWN_PAIRS = Object.freeze([...generatedPairs(), ...HAND_LISTED_PAIRS]);

/**
 * Refuse to report a clean result over an empty pair list in a real checkout.
 *
 * Every pair is derived now, so if the generator cannot be resolved AND nothing is
 * hand-listed, `KNOWN_PAIRS` is empty and every query answers "nothing drifted".
 * That is the right answer for an installed package -- but in a checkout it would
 * be a broken tool reporting a perfect score, which is the single failure mode
 * this module exists to eliminate.
 *
 * The distinction is made on whether the generator file EXISTS, not on whether the
 * list is empty: a missing generator in a checkout means the layout moved, while a
 * missing generator outside one is expected. Cheap enough to run per command.
 *
 * @param {string} root repository root to check
 * @returns {string|null} an error message, or null when the pair list is usable
 */
function assertPairsResolved(root) {
  const generatorPath = path.join(root, 'src', 'npm-package', 'scripts', 'generate-mirrors.cjs');
  if (!fs.existsSync(generatorPath)) {
    // Not a checkout (installed package, or an unrelated directory). Zero pairs is
    // the correct answer there: the canonical trees are not installed either, so
    // there is nothing to compare and no capability is lost.
    return null;
  }
  if (KNOWN_PAIRS.length > 0) return null;
  return (
    'mirror-sync resolved ZERO mirror pairs although ' +
    'src/npm-package/scripts/generate-mirrors.cjs exists. Every pair is derived from its ' +
    'GENERATED_TREES export now, so zero pairs means the export is missing or renamed. ' +
    'Refusing to report "nothing drifted" over an empty set.'
  );
}

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
      if (MIRROR_EXCLUDES.includes(entry.name)) continue;
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
 * Is `dir` excluded from version control by an ignore rule?
 *
 * `--no-index` is required to get a straight answer. Without it, `git check-ignore`
 * reports nothing for paths that ARE tracked, so a tree that is both tracked and
 * matched by an ignore rule answers "not ignored" -- the opposite of what the rule
 * says. Verified in a scratch repo: with the file staged, plain `check-ignore`
 * exits 1 while `--no-index` exits 0.
 *
 * A path that is not ignored exits 1, and so does a path outside any repository.
 * Both mean "cannot claim this tree is generated", which is the safe answer: the
 * caller then keeps the pre-existing tracked comparison.
 *
 * @param {string} root repository root
 * @param {string} dir directory relative to root
 * @returns {boolean}
 */
function isIgnored(root, dir) {
  const normalised = dir.replace(/\\/g, '/');
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', '--', normalised], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
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
 * P1-E: when `dir` is IGNORED, an empty `git ls-files` result means "nobody tracks
 * this tree", not "this tree is empty". The mirror trees are generated at prepack
 * and gitignored on purpose, so the tracked question has no answer for them, and
 * asking it reports every canonical file as missing from its mirror. Measured on
 * the real repo after P1-E landed: DRIFT for adapters, hooks/lib, build-integrity
 * and skills -- the four trees the generator had just written correctly.
 *
 * The fallback is gated on the ignore RULE, not on an empty result, so a mirror
 * tree someone genuinely emptied still reports its files as missing.
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
      .filter((p) => !p.split('/').some((seg) => MIRROR_EXCLUDES.includes(seg)));
  } catch {
    return listFiles(root, dir);
  }

  // Keep only what is actually on disk; a tracked-but-deleted file must read as
  // "missing from this side", which is what the caller then repairs.
  // P1-E: an IGNORED tree has no tracked files by design, so "git tracks nothing
  // here" must not be read as "there are no files here". The walk returns the same
  // set the generator enumerates, and SYNC_EXCLUDES still filters it, so cache
  // directories do not resurface as orphans (the #587/#588 false failure).
  if (tracked.length === 0 && isIgnored(root, dir)) {
    return listFiles(root, dir).filter(
      (p) => !p.split('/').some((seg) => MIRROR_EXCLUDES.includes(seg))
    );
  }

  return tracked
    .filter((p) => fs.existsSync(path.join(root, dir, p)))
    .sort();
}

/**
 * Compare a canonical tree against its mirror.
 *
 * Both sides are compared on the tracked file set so an untracked artifact in
 * either tree cannot be mistaken for drift. A tree that is gitignored entirely
 * (a generated mirror) is compared on its disk contents instead -- see
 * `listTrackedFiles` for why. The choice is per tree, so a pair with a tracked
 * canonical tree and a generated mirror behaves correctly on both sides.
 *
 * @param {string} root repository root
 * @param {string} canonical canonical dir (relative)
 * @param {string} mirror mirror dir (relative)
 * @param {{exclude?: string[]}} [options] extra directory names to skip for this pair
 * @returns {{inSync: boolean, missing: string[], differing: string[], extra: string[]}}
 */
function diffTrees(root, canonical, mirror, options = {}) {
  // The per-pair list ADDS to the global rule, it does not replace it: a caller
  // passing `exclude: ['dist']` must not silently re-enable `__tests__`.
  const exclude = [...MIRROR_EXCLUDES, ...(options.exclude || [])];
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
    // Not silently "all in sync": zero pairs means nothing was checked, and an
    // empty verdict must never read as a passing one. The message distinguishes
    // "wrong directory" from "the generator broke", because the second is a real
    // defect in a checkout and the first is a typing mistake.
    const broken = assertPairsResolved(root);
    process.stdout.write(
      broken
        ? `sync-mirrors: NOT MEASURABLE\n  ${broken}\n`
        : 'sync-mirrors: NOT MEASURABLE (no mirror pairs found — is this the xp-gate repo?)\n'
    );
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
  HAND_LISTED_PAIRS,
  assertPairsResolved,
  listFiles,
  listTrackedFiles,
  diffTrees,
  collectMirrorPairs,
  syncMirrors,
  handleSyncMirrors,
};
