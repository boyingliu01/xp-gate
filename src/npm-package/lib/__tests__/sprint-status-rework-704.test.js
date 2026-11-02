/**
 * @test REQ-704 Sprint Status 返工率
 * @intent `--rework-check` 的返工率恒为 0，且会把任何正确的值覆盖成 0。
 *
 *         根因有两层，必须同时修好才算真的修好：
 *         (1) 统计区间的下界用了 `completed_at` —— 按定义它是 sprint **结束**的
 *             时刻，而 sprint 的全部提交都发生在它之前。于是 `git log --since
 *             <completed_at>` 返回空集。要统计的区间是「开始 → 结束」，
 *             实际统计的区间是「结束 → 现在」，恰好是空的。
 *         (2) `total_sprint_commits` 从未被计算过，只被读取（值恒为 0），
 *             再经 `Math.max(total, 1)` 兜底成 1，使 `0/1` 恒等于 0。
 *
 *         这是一个质量指标的 fail-open：返工率是 #369 用来暴露「门禁全过但仍
 *         返工」的唯一信号，恒为 0 意味着返工永远不可观测，而 CLI 还会主动打印
 *         「All sprints within acceptable rework rate」。告警阈值永不触发。
 *
 *         测试必须用真实 git 仓库：这个 bug 的全部性质都藏在 `git log --since`
 *         的行为里，任何 mock 都能让它「通过」。
 * @covers AC-704-01, AC-704-02, AC-704-03, AC-704-04
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const sprintStatus = require('../sprint-status');

function git(cwd, args, env = {}) {
  // `-c core.hooksPath=` disables hooks for this fixture. Without it, the
  // temporary repo inherits this machine's global hooksPath and every fixture
  // commit runs the full pre-commit suite (~60s each, and it can BLOCK on
  // unrelated file-hygiene findings in .xp-gate/reports). The test asserts on
  // `git log`, so hooks contribute nothing but time and flakiness.
  return execFileSync('git', ['-c', 'core.hooksPath=', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Capture console.log so assertions read the CLI output, not a return value. */
function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = fn();
    return { lines, result };
  } finally {
    console.log = original;
  }
}

describe('sprint-status --rework-check 返工率 (#704)', () => {
  let dir;
  let stateFile;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-704-'));
    git(dir, ['init', '-q', '.']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);

    // 4 commits: 2 feat + 2 fix => real rework rate 50%, above the 30% threshold.
    // Author/committer dates are pinned so the sprint window is deterministic.
    const commits = [
      ['2026-11-01T10:00:00Z', 'a.txt', 'feat: initial'],
      ['2026-11-01T10:10:00Z', 'b.txt', 'fix(core): repair the thing'],
      ['2026-11-01T10:20:00Z', 'c.txt', 'feat: another'],
      ['2026-11-01T10:30:00Z', 'd.txt', 'fix: 修掉一个缺陷'],
    ];
    for (const [date, file, message] of commits) {
      fs.writeFileSync(path.join(dir, file), file);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', message], {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });
    }

    fs.mkdirSync(path.join(dir, '.sprint-state'), { recursive: true });
    stateFile = path.join(dir, '.sprint-state', 'sprint-state.json');
    // completed_at is AFTER every commit — this is the real CLOSE ordering, and
    // the exact input that made `--since completed_at` return an empty set.
    fs.writeFileSync(stateFile, JSON.stringify({
      _schema_version: 1,
      id: 'sprint-2026-11-01-01',
      phase: 6,
      status: 'completed',
      started_at: '2026-11-01T09:00:00.000Z',
      metrics: { completed_at: '2026-11-01T11:00:00.000Z' },
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC-704-01: counts fix commits between sprint start and completion, not after completion', () => {
    const { lines } = captureLogs(() => sprintStatus.handleReworkCheck(dir, 3650));
    const output = lines.join('\n');

    // The two fix commits happened inside the sprint window. Reporting 0 means
    // the lower bound is on the wrong side of the sprint.
    expect(output).toMatch(/2 fix \/ 4 total commits/);
  });

  it('AC-704-02: reports the real rate and raises the >30% alert', () => {
    const { lines } = captureLogs(() => sprintStatus.handleReworkCheck(dir, 3650));
    const output = lines.join('\n');

    expect(output).toMatch(/50\.0%/);
    expect(output).toMatch(/exceeds 30% threshold/);
    // The all-clear line must NOT be printed when a sprint is over threshold:
    // that sentence is what turns a fail-open into a false reassurance.
    expect(output).not.toMatch(/All sprints within acceptable rework rate/);
  });

  it('AC-704-03: persists the computed rate and the commit total it was computed from', () => {
    captureLogs(() => sprintStatus.handleReworkCheck(dir, 3650));

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(persisted.metrics.rework_rate).toBe(0.5);
    // total_sprint_commits was never computed before; the report needs it to
    // stay meaningful on the next run.
    expect(persisted.metrics.total_sprint_commits).toBe(4);
  });

  it('AC-704-04: an empty window reports 0/0, not a confident 0%', () => {
    // Second sprint state: its window contains no commits at all.
    fs.writeFileSync(stateFile, JSON.stringify({
      _schema_version: 1,
      id: 'sprint-2026-11-02-01',
      phase: 6,
      status: 'completed',
      started_at: '2026-11-01T10:35:00.000Z',
      metrics: { completed_at: '2026-11-01T12:00:00.000Z' },
    }, null, 2));

    const { lines } = captureLogs(() => sprintStatus.handleReworkCheck(dir, 3650));
    const output = lines.join('\n');

    // Zero commits in the window is NOT "0% rework" — it is "nothing to
    // measure". Rendering it as 0.0% would recreate this same fail-open one
    // level down.
    expect(output).toMatch(/0 fix \/ 0 total commits/);
  });
});
