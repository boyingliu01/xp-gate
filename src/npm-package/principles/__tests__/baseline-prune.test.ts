/**
 * @test REQ-452 REQ-3
 * @intent A baseline entry for a file that no longer exists must not be kept
 *         forever. Previously `classifyFiles` parsed `deleted` but nothing
 *         consumed it, so `.warnings-baseline.json` accumulated stale entries
 *         that let a re-created file inherit a bogus allowance.
 * @covers AC-452-10, AC-452-11, AC-452-12, AC-452-13
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
});
