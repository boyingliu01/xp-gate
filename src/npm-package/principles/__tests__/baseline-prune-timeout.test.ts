/**
 * @test REQ-452 REQ-3
 * @intent The baseline pruner runs inside a git hook, so its worst failure mode is
 *         not a wrong answer but a commit that never returns. Every git call it
 *         makes must carry a timeout, and the timeout must be short enough that a
 *         wedged git degrades to "keep the entry" rather than hanging the hook.
 * @covers AC-452-14
 *
 * Mocked rather than stubbed with a fake binary: `execFileSync` resolves PATH
 * entries without consulting PATHEXT unless `shell` is set, so a `git.cmd` shim on
 * PATH is silently ignored in favour of the real binary -- a test built that way
 * passes while proving nothing. Asserting the options handed to child_process
 * tests the guard itself instead of Node's PATH resolution.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { pruneBaselineEntries } from '../baseline-prune';

/** Generous for a healthy `git ls-files`, short enough not to wedge a hook. */
const MAX_ACCEPTABLE_GIT_TIMEOUT_MS = 60_000;

describe('baseline pruning git invocation (#452)', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('AC-452-14: bounds every git call with a timeout', () => {
    execFileSyncMock.mockReturnValue('tracked.ts\n');

    pruneBaselineEntries(JSON.stringify({ 'gone.ts': { 'clean-code.large-file': 1 } }), '/tmp/project');

    expect(execFileSyncMock).toHaveBeenCalled();
    for (const call of execFileSyncMock.mock.calls) {
      const options = call[2] as { timeout?: number };
      expect(typeof options.timeout).toBe('number');
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(MAX_ACCEPTABLE_GIT_TIMEOUT_MS);
    }
  });

  it('AC-452-14: a git timeout keeps entries instead of failing the hook', () => {
    // execFileSync reports a killed process as an error with no stdout, which is
    // how a wedged git surfaces here.
    execFileSyncMock.mockImplementation(() => {
      const error = new Error('spawnSync git ETIMEDOUT') as Error & { signal?: string };
      error.signal = 'SIGTERM';
      throw error;
    });

    const result = pruneBaselineEntries(
      JSON.stringify({ 'gone.ts': { 'clean-code.large-file': 1 } }),
      '/tmp/project',
    );

    // Fail closed: an unreadable index must never justify deleting an entry.
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(['gone.ts']);
    expect(result.error).toBeDefined();
  });
});
