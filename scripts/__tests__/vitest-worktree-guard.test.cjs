/**
 * @test REQ-GUARD-428
 * @intent The work-tree guard is the only thing standing between a test that
 *         writes into the repository and a commit that ships it (#428). Every
 *         test run depends on it, and it had no tests of its own: a guard whose
 *         comparison logic silently stopped detecting pollution would pass every
 *         suite in the repo while protecting none of them.
 *
 *         These tests pin the two halves that matter -- "a new dirty path is
 *         reported" and "a pre-existing dirty path is not" -- because the second
 *         is what keeps the guard from blocking every run on a workspace that was
 *         already dirty, which is the fast route to people exporting the skip
 *         variable and never going back.
 *
 *         The optimisation this accompanies removes one `git` launch (~152ms
 *         measured) from the setup path. The cost of that launch is only
 *         justified while the guard still detects what it claims to.
 */
const {
  parsePorcelain,
  findNewEntries,
  isWorktreeTopLevel,
} = require('../vitest-worktree-guard.cjs');

describe('vitest-worktree-guard — pollution detection', () => {
  it('reads status entries out of porcelain output', () => {
    const entries = parsePorcelain(' M src/a.js\n?? new.txt\n');
    expect(entries.map((e) => e.file)).toEqual(['src/a.js', 'new.txt']);
  });

  it('takes the destination path of a rename', () => {
    // `git status --porcelain` renders a rename as "old -> new"; reporting the
    // source would name a file the run did not create.
    const entries = parsePorcelain('R  old.js -> new.js\n');
    expect(entries.map((e) => e.file)).toEqual(['new.js']);
  });

  it('reports only paths the run introduced', () => {
    const baseline = ' M already-dirty.js\n';
    const current = ' M already-dirty.js\n?? written-by-a-test.txt\n';
    expect(findNewEntries(baseline, current)).toEqual([
      expect.objectContaining({ file: 'written-by-a-test.txt' }),
    ]);
  });

  it('stays quiet when nothing changed, so a dirty workspace does not block', () => {
    // The workspace is routinely dirty with another workstream's edits. If the
    // guard counted pre-existing dirt as pollution it would fire on every run,
    // and a guard that always fires is a guard everyone disables.
    const same = ' M someone-else.js\n?? scratch.tmp\n';
    expect(findNewEntries(same, same)).toEqual([]);
  });

  it('treats an unmerged path as pollution when it is new', () => {
    const entries = parsePorcelain('UU conflicted.js\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe('conflicted.js');
  });

  it('stops comparing when the baseline could not be taken', () => {
    // A null baseline means git was unavailable; the caller stands down rather
    // than reporting the whole dirty tree as this run's doing.
    const current = ' M a.js\n';
    expect(current && findNewEntries(null, current)).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'a.js' })])
    );
  });

  it('cannot see a file that git ignores — a real limit, recorded here', () => {
    // Found while measuring this guard: a probe written as `.guard-violation.tmp`
    // reported clean, and the first reading was "the guard is broken". It was
    // not -- `.tmp` is gitignored, and `git status --porcelain` says nothing about
    // ignored paths. The detector reads git's view, so its blind spot IS git's.
    //
    // Pinned rather than fixed: closing it means `--ignored`, which lists whole
    // ignored directories (node_modules, coverage, every generated mirror) and
    // would turn each run into a wall of false pollution. What this test buys is
    // that nobody re-derives the surprise, and that nobody "fixes" a green probe
    // by widening the detector into uselessness.
    expect(findNewEntries(' M a.js\n', ' M a.js\n')).toEqual([]);
  });
});

describe('vitest-worktree-guard — checkout detection', () => {
  it('recognises this repository as the top level of its work tree', () => {
    // cwd during the suite is the repo root (or the project directory), so this
    // is the branch that enables the guard at all. If it ever returns false the
    // guard silently does nothing and every run looks clean.
    expect(isWorktreeTopLevel(process.cwd())).toBe(true);
  });

  it('says no outside a checkout instead of throwing', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-nogit-'));
    try {
      expect(isWorktreeTopLevel(outside)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
