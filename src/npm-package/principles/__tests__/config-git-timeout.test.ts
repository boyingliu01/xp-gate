/**
 * @test REQ-457
 * @intent Config resolution shells out to git on every principles run, inside a git
 *         hook. Every such call must be bounded: an unbounded one turns a wedged git
 *         into a commit that never returns. Covers gitToplevel(), which sits on the
 *         default path because gate-4.sh passes no --config.
 * @covers AC-457-12
 *
 * Mocks child_process rather than shimming git on PATH -- execFileSync resolves PATH
 * without PATHEXT unless shell is set, so a stub binary is silently ignored and the
 * test would pass while proving nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

import { loadConfig } from '../config';

/** Long enough for a healthy `git rev-parse`, short enough not to wedge a hook. */
const MAX_ACCEPTABLE_GIT_TIMEOUT_MS = 30_000;

describe('config loading git invocation (#457)', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('AC-457-12: bounds every git call with a timeout', async () => {
    execFileSyncMock.mockReturnValue('/tmp/project\n');

    await loadConfig();

    expect(execFileSyncMock).toHaveBeenCalled();
    for (const call of execFileSyncMock.mock.calls) {
      const options = call[2] as { timeout?: number };
      expect(typeof options.timeout).toBe('number');
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(MAX_ACCEPTABLE_GIT_TIMEOUT_MS);
    }
  });

  it('AC-457-12: a hung git falls back to defaults instead of hanging the hook', async () => {
    execFileSyncMock.mockImplementation(() => {
      const error = new Error('spawnSync git ETIMEDOUT') as Error & { signal?: string };
      error.signal = 'SIGTERM';
      throw error;
    });

    // Must resolve. If this rejects or blocks, the pre-commit hook hangs with it.
    // Compared against the same resolution with a working git so the assertion does
    // not hard-code a threshold the repo's own .principlesrc may override.
    execFileSyncMock.mockReturnValue('/tmp/project\n');
    const baseline = await loadConfig();
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync git ETIMEDOUT'), { signal: 'SIGTERM' });
    });
    const degraded = await loadConfig();

    expect(degraded.rules['clean-code']['large-file'].threshold)
      .toBe(baseline.rules['clean-code']['large-file'].threshold);
  });
});
