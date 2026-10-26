/**
 * @test REQ-624
 * @intent `npm run build:dsh-plugin` must actually run its npm sub-steps on
 *         every platform. `spawnSync('npm', ...)` without `shell: true` works on
 *         Linux (npm is a real executable) and fails on Windows (npm is
 *         npm.cmd, which CreateProcess cannot launch directly). The failure was
 *         also misattributed: the wrapper printed "dsh build (tsc) failed" while
 *         a direct `npm run build` exited 0, so the message blamed the compiler
 *         for a spawn problem.
 *
 *         This is not just a local inconvenience. plugins/dsh/skills/ is a build
 *         artifact (.gitignore line 150) and the vitest suite asserts it exists.
 *         That is why CI's Mutation Testing job failed in its initial dry run:
 *         the tree had never been built.
 *
 *         The test reads the script's source rather than executing it, because
 *         the defect only manifests on Windows while CI runs on Linux -- a
 *         behavioural test would be green on the very platform where the bug is
 *         invisible.
 * @covers AC-624-01, AC-624-02
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-plugin.mjs');

function scriptSource(): string {
  return fs.readFileSync(SCRIPT, 'utf8');
}

/**
 * Every `spawnSync('npm', ...)` call, captured to the end of its line.
 *
 * Each call in this file is written on one line; a wrapped call would itself
 * fail the assertion below, which is the intent -- that is how `shell: true`
 * goes missing unnoticed.
 */
function npmSpawnCalls(source: string): string[] {
  const calls: string[] = [];
  const marker = "spawnSync('npm'";
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) break;
    const end = source.indexOf('\n', at);
    calls.push(source.slice(at, end === -1 ? undefined : end));
    from = at + marker.length;
  }
  return calls;
}

describe('AC-624-01: npm sub-steps are launched in a form Windows can execute', () => {
  it('still drives the two dsh sub-steps through npm', () => {
    const source = scriptSource();
    // The two steps these tests care about must still be invoked as npm scripts;
    // a future edit that drops one would make the spawn check vacuous.
    expect(source).toContain("runNpmScript(dshDir, 'build')");
    expect(source).toContain("runNpmScript(dshDir, 'prepare-skills')");
  });

  it('finds at least one npm spawn and gives every one shell: true', () => {
    const calls = npmSpawnCalls(scriptSource());
    // Without this, the assertion below would pass by finding nothing at all.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const offenders = calls.filter((c) => !c.includes('shell: true'));
    expect(offenders).toEqual([]);
  });
});

describe('AC-624-02: a failed sub-step is reported under its own name', () => {
  it('does not blame tsc for a non-zero `npm run build`', () => {
    const source = scriptSource();
    expect(source).not.toContain('dsh build (tsc) failed');
    expect(source).toContain('npm run build');
  });

  it('surfaces the spawn error itself when there is one', () => {
    // A null status with no explanation is what made this bug invisible; the
    // wrapper must print result.error when spawn failed outright.
    expect(scriptSource()).toContain('result.error');
  });
});
