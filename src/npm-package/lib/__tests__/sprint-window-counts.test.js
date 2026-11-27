/**
 * @test REQ-SPRINT-WINDOW-COUNTS
 * @intent 返工率的分子分母**必须来自同一次 `git log`**，覆盖 sprint 自己的窗口
 *         （开始 → 完成）。#704 之前的实现有两个结构性错误：
 *
 *         - 分母读自 `state.metrics.total_sprint_commits`，而**没有任何代码写过
 *           这个字段**，所以它永远是 0，然后被 `Math.max(total, 1)` 抬成 1；
 *         - `--since` 边界用的是 sprint 的**结束**时间，于是窗口是空的。
 *
 *         合起来：比率只能是 0，而摘要仍然说"在可接受范围内"。
 *
 *         还有一条：`total === 0` 是**有意义的答案**（窗口里没什么可测），必须
 *         如实报告，不能包装成 0% 返工。
 *
 * @covers AC-SPRINT-WINDOW-01
 * @covers AC-SPRINT-WINDOW-02
 * @covers AC-SPRINT-WINDOW-03
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { getWindowCommitCounts } = require('../sprint-status.js');

let repo;
let out;

/** A git invocation scoped to the fixture, with global hooks disabled. */
function git(args, opts = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, encoding: 'utf8', ...opts,
  });
}

function commit(message, isoDate) {
  git(['commit', '--allow-empty', '-m', message], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate,
    },
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'xp-gate-window-'));
  out = [];
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('getWindowCommitCounts', () => {
  it('counts fixes and total commits in one pass', () => {
    commit('feat: add thing', '2026-11-01T00:00:00Z');
    commit('fix: repair thing', '2026-11-02T00:00:00Z');
    commit('feat: another', '2026-11-03T00:00:00Z');

    const counts = getWindowCommitCounts(repo, '2026-10-31T00:00:00Z', '2026-11-04T00:00:00Z');
    expect(counts.total).toBe(3);
    expect(counts.fix).toBe(1);
  });

  it('recognises the fix vocabulary the rate depends on', () => {
    // A missed pattern under-counts fixes and therefore overstates the health of the
    // sprint, which is the direction that reassures wrongly.
    commit('fix(parser): handle empty', '2026-11-01T00:00:00Z');
    commit('hotfix: urgent', '2026-11-01T01:00:00Z');
    commit('修复：空指针', '2026-11-01T02:00:00Z');
    commit('chore: tidy', '2026-11-01T03:00:00Z');

    const counts = getWindowCommitCounts(repo, '2026-10-31T00:00:00Z', '2026-11-02T00:00:00Z');
    expect(counts.fix).toBe(3);
    expect(counts.total).toBe(4);
  });

  it('returns zero/zero for an empty window rather than a wide one', () => {
    // #704: the old --since bound was the sprint's END, so the window was empty for
    // every sprint. A window with nothing in it must say so.
    commit('feat: x', '2026-11-01T00:00:00Z');
    const counts = getWindowCommitCounts(repo, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z');
    expect(counts).toEqual({ fix: 0, total: 0 });
  });

  it('returns zero/zero without a start bound', () => {
    // No start means no window; counting everything would be a different question.
    expect(getWindowCommitCounts(repo, undefined, '2026-11-04T00:00:00Z')).toEqual({ fix: 0, total: 0 });
  });

  it('drops an unparsable bound rather than passing it to git', () => {
    // git silently ignores a bad --since, so passing it through would widen the
    // window with no signal. The code validates first and omits the flag; the valid
    // --until still bounds the far end. The result is a WIDER window, not an empty
    // one -- I asserted the opposite here first and the code disagreed.
    commit('fix: a', '2026-11-01T00:00:00Z');
    const counts = getWindowCommitCounts(repo, 'not-a-date', '2026-11-02T00:00:00Z');
    expect(counts.total).toBe(1);
    expect(counts.fix).toBe(1);
  });

  it('returns zero/zero outside a git repository instead of throwing', () => {
    // The command is a diagnostic; a directory that is not a repo has nothing to
    // measure.
    const plain = mkdtempSync(join(tmpdir(), 'xp-gate-norepo-'));
    try {
      mkdirSync(join(plain, 'sub'), { recursive: true });
      expect(getWindowCommitCounts(plain, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'))
        .toEqual({ fix: 0, total: 0 });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
