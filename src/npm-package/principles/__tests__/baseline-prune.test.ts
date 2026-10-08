/**
 * @test REQ-452 REQ-3
 * @intent A baseline entry for a file that no longer exists must not be kept
 *         forever. Previously `classifyFiles` parsed `deleted` but nothing
 *         consumed it, so `.warnings-baseline.json` accumulated stale entries
 *         that let a re-created file inherit a bogus allowance.
 * @covers AC-452-10, AC-452-11, AC-452-12, AC-452-13, AC-452-14
 *
 * The removal is deliberately DOUBLE-CONFIRMED: a path is only treated as
 * deleted when the filesystem says it is absent AND git no longer tracks it.
 * Either signal alone produces false positives -- a sparse checkout, a rebase
 * mid-flight, a case-insensitive filesystem, or a symlink all make an existing
 * tracked file look "missing".
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneBaselineEntries } from '../baseline-prune';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xpgate-452-'));
  tempDirs.push(dir);
  return dir;
}

/** Create a git repo with one committed file, and return its root. */
function makeRepoWithCommit(): { root: string; tracked: string } {
  const root = makeTempDir();
  const tracked = 'tracked.ts';
  const run = (args: string[]): void => {
    try {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`git ${args.join(' ')} failed in ${root}: ${detail}`);
    }
  };
  try {
    writeFileSync(join(root, tracked), 'export const a = 1;\n', 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not seed repo file: ${detail}`);
  }
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  // This fixture is scaffolding, not a real commit: the global XP-Gate hooks are
  // installed on this machine and would otherwise block the seed commit
  // (Gate 5a rejects an untested source file). `core.hooksPath` is set to a
  // non-existent path rather than using --no-verify so the intent is explicit
  // and cannot be mistaken for bypassing this repository's own gates.
  run(['config', 'core.hooksPath', join(root, '.no-hooks')]);
  run(['add', tracked]);
  run(['commit', '-m', 'seed']);
  return { root, tracked };
}

/**
 * Stage many paths at once, to push `git ls-files` output past the 1 MiB default
 * stdout buffer that `execFileSync` would otherwise apply.
 *
 * Uses `git update-index --index-info` to write the index directly rather than
 * creating files and running `git add`: that path costs over 50s for this many
 * entries (filesystem + index churn), whereas feeding the index in one batch takes
 * under a second. The blob hash is git's well-known empty-blob id, so nothing needs
 * to exist on disk -- which is fine, because the assertion is about `git ls-files`
 * reporting the index, not about the working tree.
 */
function stageManyPaths(root: string, count: number, nameFor: (index: number) => string): void {
  const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(`100644 ${EMPTY_BLOB}\t${nameFor(i)}`);
  }
  try {
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: root,
      input: `${lines.join('\n')}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not stage filler paths: ${detail}`);
  }
}

/**
 * A baseline shaped like the real `.warnings-baseline.json` payload.
 *
 * The on-disk format is a FLAT path -> entry map, verified against the committed
 * file; there is no `files` wrapper.
 */
function baselineWith(paths: string[]): string {
  const files: Record<string, unknown> = {};
  for (const path of paths) {
    files[path] = { totalWarnings: 3, lastAnalyzed: '2026-10-03T00:00:00.000Z' };
  }
  return JSON.stringify(files);
}

/**
 * Stage exact paths in the index without creating working-tree files.
 *
 * Index-only staging is what makes the case-sensitivity assertions portable:
 * neither spelling exists on disk (so the `existsSync` half of the double-confirm
 * is false everywhere), and the only signal left is the comparison against the
 * git index -- which is exactly the behavior under test. The blob hash is git's
 * well-known empty-blob id, so nothing needs to exist on disk.
 */
function stageIndexOnly(root: string, paths: string[]): void {
  const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  const input = paths.map((path) => `100644 ${EMPTY_BLOB}\t${path}`).join('\n');
  try {
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: root,
      input: `${input}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not stage index paths: ${detail}`);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('#452 REQ-3 stale baseline entries are pruned', () => {
  it('AC-452-10: a path that is absent AND untracked is reported for removal', () => {
    const { root } = makeRepoWithCommit();
    const stale = 'gone-forever.ts';

    const result = pruneBaselineEntries(baselineWith([stale]), root);

    expect(result.removed).toContain(stale);
    expect(result.kept).not.toContain(stale);
  });

  it('AC-452-11: an existing tracked file is KEPT even when absent from disk', () => {
    // Simulates a sparse checkout / mid-rebase / symlinked worktree: the file
    // is gone from the working tree but git still tracks it. Removing the entry
    // here would silently discard a legitimate allowance.
    const { root, tracked } = makeRepoWithCommit();
    rmSync(join(root, tracked));

    const result = pruneBaselineEntries(baselineWith([tracked]), root);

    expect(result.kept).toContain(tracked);
    expect(result.removed).not.toContain(tracked);
  });

  it('AC-452-12: a file present on disk is kept', () => {
    const { root, tracked } = makeRepoWithCommit();

    const result = pruneBaselineEntries(baselineWith([tracked]), root);

    expect(result.kept).toContain(tracked);
    expect(result.removed).toHaveLength(0);
  });

  it('AC-452-13: an untracked-but-present file is kept (git is not authoritative alone)', () => {
    const { root } = makeRepoWithCommit();
    const untracked = 'untracked.ts';
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(join(root, untracked), 'export const b = 2;\n', 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`could not write untracked file: ${detail}`);
    }

    const result = pruneBaselineEntries(baselineWith([untracked]), root);

    expect(result.kept).toContain(untracked);
  });

  it('AC-452-10: pruning is non-destructive — it never mutates the input', () => {
    const { root } = makeRepoWithCommit();
    const input = baselineWith(['gone-forever.ts', 'also-gone.ts']);

    pruneBaselineEntries(input, root);

    // The caller decides when to persist; the helper must not rewrite in place.
    const parsed = JSON.parse(input) as Record<string, unknown>;
    expect(Object.keys(parsed)).toHaveLength(2);
  });

  it('AC-452-11: every entry is preserved when git is unavailable', () => {
    // A non-repo directory means `git ls-files` fails. Failing closed (keep
    // everything) is safer than deleting entries we cannot confirm.
    const dir = makeTempDir();
    const paths = ['a.ts', 'b.ts'];

    const result = pruneBaselineEntries(baselineWith(paths), dir);

    expect(result.kept.sort()).toEqual(paths);
    expect(result.removed).toHaveLength(0);
  });

  it('AC-452-13: an empty baseline yields empty kept/removed lists', () => {
    const { root } = makeRepoWithCommit();

    const result = pruneBaselineEntries(baselineWith([]), root);

    expect(result.kept).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('AC-452-12: a malformed baseline is preserved rather than silently emptied', () => {
    // The reporter's `{}` came from this path. Keeping the entries and
    // reporting an error is the fail-safe behaviour.
    const { root } = makeRepoWithCommit();

    const result = pruneBaselineEntries('{ not json', root);

    expect(result.removed).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it('AC-452-10: pruning still works when the git index exceeds the default pipe buffer', () => {
    // `execFileSync` defaults to a 1 MiB stdout buffer. A repo whose `git
    // ls-files` output exceeds it throws, which `listTrackedFiles` would report
    // as "git unavailable" -- silently disabling pruning at exactly the scale
    // where a stale baseline is most likely. Committing enough paths to blow past
    // 1 MiB proves the raised maxBuffer is actually in effect: without it every
    // entry is merely "kept" and the stale path below would never be reported.
    const { root } = makeRepoWithCommit();
    // Measured: each path is ~48 bytes once `git ls-files` newline-joins it, so
    // 1 MiB / 48 = ~21.8k entries. Use 30000 (~1.4 MiB) so the threshold is
    // cleared with real headroom rather than marginally -- an earlier version used
    // 19000, which came to 0.88 MiB and passed even with the buffer bug present.
    stageManyPaths(root, 30000, (i) => `filler/s${i}/a-fairly-long-file-name-padding.ts`);

    const result = pruneBaselineEntries(baselineWith(['deleted-long-ago.ts']), root);

    expect(result.removed).toEqual(['deleted-long-ago.ts']);
    expect(result.error).toBeUndefined();
  });

  it('AC-452-14: on a case-sensitive filesystem the index path is the canonical form', () => {
    // Two tracked files whose names differ only by case are two DIFFERENT files on
    // Linux. A baseline key that matches neither spelling exactly is a phantom:
    // folding it to `case/alpha.ts` used to match the index and retain the entry
    // forever -- the same stale-allowance bug this module exists to remove, since
    // re-creating `case/ALPHA.ts` would inherit the retained allowance.
    const { root } = makeRepoWithCommit();
    stageIndexOnly(root, ['case/Alpha.ts', 'case/alpha.ts']);

    const result = pruneBaselineEntries(
      baselineWith(['case/ALPHA.ts']),
      root,
      { caseInsensitivePaths: false },
    );

    expect(result.removed).toEqual(['case/ALPHA.ts']);
    expect(result.kept).toHaveLength(0);
  });

  it('AC-452-14: a case-sensitive filesystem does not conflate a differently-cased key with a tracked path', () => {
    const { root } = makeRepoWithCommit();
    stageIndexOnly(root, ['src/Tracked.ts']);

    const result = pruneBaselineEntries(
      baselineWith(['src/tracked.ts']),
      root,
      { caseInsensitivePaths: false },
    );

    expect(result.removed).toEqual(['src/tracked.ts']);
  });

  it('AC-452-14: an exact index match is kept on a case-sensitive filesystem', () => {
    // Guards against the opposite regression: dropping the fold must not turn a
    // legitimately tracked path into a prunable one.
    const { root } = makeRepoWithCommit();
    stageIndexOnly(root, ['case/alpha.ts']);

    const result = pruneBaselineEntries(
      baselineWith(['case/alpha.ts']),
      root,
      { caseInsensitivePaths: false },
    );

    expect(result.kept).toContain('case/alpha.ts');
    expect(result.removed).toHaveLength(0);
  });

  it('AC-452-14: a case-insensitive filesystem keeps the retain-bias for a differently-cased key', () => {
    // On Windows (and macOS default volumes) `src/tracked.ts` and `src/Tracked.ts`
    // are the same file, and the key can be written by a tool that reported a
    // different casing than the index. Losing that allowance in a sparse checkout
    // -- when `existsSync` cannot confirm either spelling -- is the failure mode
    // the original fold was introduced to prevent, so case-folding stays enabled
    // exactly where the filesystem actually folds.
    const { root } = makeRepoWithCommit();
    stageIndexOnly(root, ['src/Tracked.ts']);

    const result = pruneBaselineEntries(
      baselineWith(['src/tracked.ts']),
      root,
      { caseInsensitivePaths: true },
    );

    expect(result.kept).toContain('src/tracked.ts');
    expect(result.removed).toHaveLength(0);
  });

  it('AC-452-14: the default follows the host filesystem, not a hardcoded assumption', () => {
    // This repository's own tests must stay portable: Linux CI and this Windows
    // checkout have to disagree here, because the correct answer IS platform
    // dependent. The assertion pins the wiring (default = detection) rather than a
    // single outcome.
    const { root } = makeRepoWithCommit();
    stageIndexOnly(root, ['src/Tracked.ts']);

    const result = pruneBaselineEntries(baselineWith(['src/tracked.ts']), root);
    const folded = process.platform === 'win32' || process.platform === 'darwin';

    if (folded) {
      expect(result.kept).toContain('src/tracked.ts');
      expect(result.removed).toHaveLength(0);
    } else {
      expect(result.removed).toEqual(['src/tracked.ts']);
    }
  });
});
