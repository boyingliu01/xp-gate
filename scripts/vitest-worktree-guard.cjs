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

function gitStatus(cwd) {
  return spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
}

function parsePorcelain(text) {
  const entries = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let file = line.slice(3);
    const renameArrow = file.indexOf(' -> ');
    if (renameArrow !== -1) file = file.slice(renameArrow + 4);
    // An unmerged path carries a first-column state; anything dirty is dirty.
    const sigil = (xy[1] || '').trim() || (xy[0] || '').trim() || '?';
    entries.push({ status: xy.includes('M') ? 'M' : sigil, file: file.trim() });
  }
  return entries;
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

  if (!isWorktreeTopLevel(cwd)) {
    return () => Promise.resolve();
  }
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
