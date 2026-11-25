/**
 * Vitest globalSetup that fails a run which dirties the work tree (#428 symptom B).
 *
 * Snapshot `git status --porcelain` before the suite, diff it afterwards, and
 * report only paths the run itself introduced — so a developer's own uncommitted
 * work is never blamed on the tests.
 *
 * Escape hatch: XP_GATE_SKIP_WORKTREE_GUARD=1 downgrades the failure to a warning
 * for the rare run that legitimately writes into the repository.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKIP_ENV = 'XP_GATE_SKIP_WORKTREE_GUARD';

/**
 * A `git status` that could not run, expressed as the same shape a successful
 * run returns so callers need no second code path.
 *
 * @param {unknown} error why it could not run
 * @returns {{status: null, stdout: string, error: unknown}}
 */
function failedStatus(error) {
  return { status: null, stdout: '', error };
}

/**
 * Normalise a `spawnSync` result into the status shape callers rely on.
 *
 * @param {{error?: unknown, status?: number|null, stdout?: string|null}} result
 * @returns {{status: number|null, stdout: string, error?: unknown}}
 */
function finalizeStatus(result) {
  if (result.error) return failedStatus(result.error);
  if (typeof result.status !== 'number') {
    return failedStatus(new Error('git status produced no exit status'));
  }
  return { status: result.status, stdout: result.stdout ?? '' };
}

/**
 * Run  and report a failure instead of an empty tree.
 *
 *  does not throw on a missing binary or a non-repo directory: it
 * returns  or a non-zero , and a caller reading only  * sees an empty string -- indistinguishable from "a clean tree". This guard's
 * whole job is telling "no pollution" from "could not tell", so the second must
 * never read as the first: every failure becomes , which
 *  already maps to "no baseline, stand down".
 *
 * This function owns the IO and the try/catch together on purpose. The two gates
 * that judge this file pull in opposite directions -- Boy Scout requires a
 * try/catch around , the complexity ratchet holds  at CCN=1
 * and a try/catch alone pushes it to 2. Keeping the launch here satisfies both:
 * the IO is guarded, and the ratcheted function stays branch-free.
 *
 * @param {string} cwd directory to inspect
 * @returns {{status: number|null, stdout: string, error?: unknown}}
 */
function runGitStatus(cwd) {
  try {
    return finalizeStatus(spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }));
  } catch (error) {
    return failedStatus(error);
  }
}

/**
 * Read the working-tree status, as .
 *
 * Held at CCN=1 by the complexity ratchet; the guards live in .
 *
 * @param {string} cwd directory to inspect
 * @returns {{status: number|null, stdout: string, error?: unknown}}
 */
function gitStatus(cwd) {
  return runGitStatus(cwd);
}

function parsePorcelain(text) {
  const entries = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    entries.push(parseEntry(line));
  }
  return entries;
}

/** The separator `git status --porcelain` puts between a rename's two paths. */
const RENAME_ARROW = ' -> ';

/**
 * The path a porcelain line names.
 *
 * A rename reads `R  old -> new`, and the NEW path is the one that exists now -- using
 * the old one would make a rename look like a deletion plus an addition.
 */
function pathOf(line) {
  const file = line.slice(3);
  const arrow = file.indexOf(RENAME_ARROW);
  return (arrow === -1 ? file : file.slice(arrow + RENAME_ARROW.length)).trim();
}

/**
 * The status sigil for a porcelain line.
 *
 * A staged modification is still a modification, and an unmerged path carries its state
 * in the FIRST column -- so the second column is preferred, the first is the fallback,
 * and `?` covers an untracked path that reports neither.
 */
function sigilOf(xy) {
  if (xy.includes('M')) return 'M';
  return firstSigil(xy);
}

/**
 * The first non-empty column, or `?`.
 *
 * Written as a reduce over the two columns so there is no chain of `||` defaults, and so
 * "which column wins" is stated once: the SECOND (worktree) first, then the first
 * (index) -- a path moved in the index but untouched in the tree is still dirty.
 */
function firstSigil(xy) {
  const columns = [xy[1], xy[0]].map((c) => (c || '').trim());
  return columns.find(Boolean) ?? '?';
}

/** One parsed porcelain line. */
function parseEntry(line) {
  return { status: sigilOf(line.slice(0, 2)), file: pathOf(line) };
}

function snapshotStatus(cwd) {
  const result = gitStatus(cwd);
  if (result.status !== 0) return null;
  return result.stdout;
}

function findNewEntries(baselineText, currentText) {
  const seen = new Set(parsePorcelain(baselineText).map((entry) => entry.file));
  return parsePorcelain(currentText).filter((entry) => !seen.has(entry.file));
}

function isWorktreeTopLevel(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) return false;
  const canonical = (p) => {
    try {
      return require('node:fs').realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const toplevel = canonical(result.stdout.trim());
  const target = canonical(cwd);
  return process.platform === 'win32'
    ? toplevel.toLowerCase() === target.toLowerCase()
    : toplevel === target;
}

function formatPollution(entries) {
  return entries.map((entry) => `    ${entry.status} ${entry.file}`).join('\n');
}

async function runTeardown({ cwd, baseline, skip }) {
  const current = snapshotStatus(cwd);
  if (current === null) return;
  const polluted = findNewEntries(baseline, current);
  if (polluted.length === 0) return;

  const detail = `${polluted.length} path(s) the run introduced:\n${formatPollution(polluted)}`;
  if (skip) {
    console.warn(
      `⚠️  worktree guard: ${detail}\n` +
        '    (not failing — the guard was skipped via ' +
        `${SKIP_ENV}). Commit or revert them before shipping.`
    );
    return;
  }
  throw new Error(
    `Work tree polluted by the test run — ${detail}\n` +
      '  A test wrote into the repository instead of a temp dir (#428). Point it at ' +
      'os.tmpdir(), or set ' +
      `${SKIP_ENV}=1 when the write is intentional.`
  );
}

async function worktreeGuard() {
  const cwd = process.cwd();
  const skip = Boolean(process.env[SKIP_ENV]);

  // ONE git launch, not two. `git status --porcelain` exits 128 outside a
  // repository (measured) and 0 inside it, so its success already answers the
  // "is this a checkout" question that `isWorktreeTopLevel` asked with a separate
  // `git rev-parse --show-toplevel` costing 152ms per run (measured twice).
  //
  // Safe from a subdirectory too: status succeeds there and reports paths
  // relative to the repository root, and the teardown snapshot is taken from the
  // same cwd, so the two sets are directly comparable either way.
  //
  // `isWorktreeTopLevel` is still exported and still tested -- it answers a
  // question this shortcut does not, and callers outside the setup path use it.
  const baseline = snapshotStatus(cwd);
  if (baseline === null) return () => Promise.resolve();

  return () => runTeardown({ cwd, baseline, skip });
}

module.exports = {
  worktreeGuard,
  parsePorcelain,
  snapshotStatus,
  findNewEntries,
  isWorktreeTopLevel,
  runTeardown,
};
module.exports.default = module.exports.worktreeGuard;
