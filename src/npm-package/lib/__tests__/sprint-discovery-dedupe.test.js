/**
 * @test REQ-SPRINT-DISCOVERY-DEDUPE
 * @intent 同一个 sprint 常能从两处看到（worktree 和 cwd fallback）。`dedupeById`
 *         决定保留哪一份，规则三层：worktree 胜过 cwd → 较晚的 started_at
 *         → 路径字典序。选错一份的后果不是显示问题，而是状态从过期副本读出来。
 *
 *         这些分支此前都内联在 `discoverActiveSprints`（CCN 29）里，只有跑整个
 *         发现流程才能触及。
 *
 * @covers AC-SPRINT-DISCOVERY-DEDUPE-01
 */
'use strict';

const { dedupeById, startTimeMs } = require('../sprint-discovery.js');

const entry = (over = {}) => ({
  worktreeExists: false,
  sourcePath: '/a',
  state: { id: 'sprint-1', started_at: '2026-01-01T00:00:00Z' },
  ...over,
});

describe('startTimeMs', () => {
  it('parses an ISO timestamp', () => {
    expect(startTimeMs({ started_at: '2026-01-01T00:00:00Z' })).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('returns 0 for a missing or unparseable value', () => {
    // A missing start time must rank LAST, not throw and not read as "now".
    expect(startTimeMs({})).toBe(0);
    expect(startTimeMs({ started_at: 'not a date' })).toBe(0);
    expect(startTimeMs(null)).toBe(0);
  });
});

describe('dedupeById', () => {
  it('keeps one entry per id', () => {
    expect(dedupeById([entry(), entry()])).toHaveLength(1);
  });

  it('prefers a real worktree over the cwd fallback', () => {
    const fallback = entry({ worktreeExists: false, sourcePath: '/a' });
    const worktree = entry({ worktreeExists: true, sourcePath: '/b' });
    // Order must not matter: the worktree wins either way.
    expect(dedupeById([fallback, worktree])[0].worktreeExists).toBe(true);
    expect(dedupeById([worktree, fallback])[0].worktreeExists).toBe(true);
  });

  it('prefers the later started_at when both are the same kind', () => {
    const older = entry({ sourcePath: '/old', state: { id: 'x', started_at: '2026-01-01T00:00:00Z' } });
    const newer = entry({ sourcePath: '/new', state: { id: 'x', started_at: '2026-06-01T00:00:00Z' } });
    expect(dedupeById([older, newer])[0].sourcePath).toBe('/new');
    expect(dedupeById([newer, older])[0].sourcePath).toBe('/new');
  });

  it('breaks a timestamp tie by the smaller sourcePath, deterministically', () => {
    const a = entry({ sourcePath: '/aaa' });
    const b = entry({ sourcePath: '/bbb' });
    expect(dedupeById([a, b])[0].sourcePath).toBe('/aaa');
    expect(dedupeById([b, a])[0].sourcePath).toBe('/aaa');
  });

  it('keeps distinct ids', () => {
    const one = entry({ state: { id: 'a', started_at: '2026-01-01T00:00:00Z' } });
    const two = entry({ state: { id: 'b', started_at: '2026-01-01T00:00:00Z' } });
    expect(dedupeById([one, two])).toHaveLength(2);
  });
});
