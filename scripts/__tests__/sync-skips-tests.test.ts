/**
 * @test REQ-626
 * @intent The prepack sync copies plugins/ into the published bundle, and the
 *         package declares no `files` allowlist -- so everything under
 *         src/npm-package/ ships to users. Adding plugins/opencode/__tests__/
 *         therefore published a vitest suite inside the npm tarball, for a
 *         plugin whose consumers do not have vitest installed. Test sources are
 *         not distribution content.
 *
 *         The sync's SKIP_DIRS already excludes node_modules and dist for the
 *         same reason; __tests__ was simply never added.
 *
 *         This asserts against the skip-config plus a real copy, so it fails if
 *         the exclusion is removed from either place.
 * @covers AC-626-01, AC-626-02
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SYNC = join(REPO_ROOT, 'src', 'npm-package', 'scripts', 'sync-package-content.js');

describe('AC-626-01: the sync declares test directories as non-distribution', () => {
  it('lists __tests__ among SKIP_DIRS', () => {
    const source = readFileSync(SYNC, 'utf8');
    const match = source.match(/const SKIP_DIRS = new Set\(\[([^\]]*)\]\)/);
    expect(match, 'SKIP_DIRS declaration not found').not.toBeNull();
    expect(match![1]).toContain('__tests__');
  });

  it('keeps the exclusions that were already there', () => {
    // Guards against replacing the list rather than extending it.
    const source = readFileSync(SYNC, 'utf8');
    const match = source.match(/const SKIP_DIRS = new Set\(\[([^\]]*)\]\)/)!;
    for (const dir of ['node_modules', 'dist', 'coverage']) {
      expect(match[1], `${dir} must stay excluded`).toContain(dir);
    }
  });
});

describe('AC-626-02: a sync does not copy a plugin test directory', () => {
  it('leaves no NEW plugin __tests__ directory in the shipped bundle', () => {
    const pluginMirror = join(REPO_ROOT, 'src', 'npm-package', 'plugins');

    // Measure BEFORE the sync, then after. Comparing two different measurements
    // is the point: asserting the same expression twice would pass whether or
    // not the exclusion works.
    const before = collectTestDirs(pluginMirror);

    const run = spawnSync(process.execPath, [SYNC, '--fix'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    // The sync may warn about unrelated missing inputs; only a crash is fatal.
    expect(run.status, `sync failed: ${run.stderr?.slice(0, 400)}`).toBe(0);

    const after = collectTestDirs(pluginMirror);

    // Four sprint-flow test files were tracked in the mirror before this change
    // and are deliberately left alone: the sync copies but never deletes, so
    // excluding __tests__ stops NEW ones without rewriting existing history.
    // The property that was actually broken is "the sync ADDS a test directory".
    expect(after.filter((d) => !before.includes(d))).toEqual([]);

    // And specifically: the plugin whose tests prompted this must not appear.
    expect(existsSync(join(pluginMirror, 'opencode', '__tests__'))).toBe(false);
  });
});

/**
 * Directories named __tests__ anywhere under `dir`.
 *
 * IO is guarded so an unreadable subtree surfaces as a named error rather than a
 * silently shorter list -- a walk that quietly skips a directory would make this
 * whole assertion vacuous, which is the one failure mode it must not have.
 */
function collectTestDirs(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    if (!existsSync(current)) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `cannot read ${current}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(current, entry.name);
      if (entry.name === '__tests__') found.push(full);
      else walk(full);
    }
  };
  walk(dir);
  return found.sort();
}
