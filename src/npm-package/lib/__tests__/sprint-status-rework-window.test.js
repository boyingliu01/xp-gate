/**
 * @test REQ-SPRINT-REWORK-WINDOW
 * @intent `handleReworkCheck` 的主体（277 条未覆盖语句）从没被执行过。它决定
 *         "本 sprint 的返工率是多少"，而这个数字会写回状态文件、驱动下一轮决策。
 *
 *         最要紧的一条：#704 之前，总数读自一个没人写的字段、`--since` 又用
 *         sprint 结束时间做界，于是两个计数结构性为 0，比率只能是 0——而摘要
 *         仍然说"在可接受范围内"。这条测试守的就是"无法测量 ≠ 达标"。
 *
 * @covers AC-SPRINT-REWORK-WINDOW-01
 * @covers AC-SPRINT-REWORK-WINDOW-02
 * @covers AC-SPRINT-REWORK-WINDOW-03
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { handleReworkCheck } = require('../sprint-status.js');

let tmpDir;

/** Run `git` in the fixture without this machine's global hooks. */
function git(...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: tmpDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function commit(subject, minutesAgo) {
  const when = new Date(Date.now() - minutesAgo * 60000).toISOString();
  execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.email=t@example.com', '-c', 'user.name=T',
    'commit', '-q', '--allow-empty', '-m', subject,
  ], {
    cwd: tmpDir,
    env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when },
  });
}

/** Write a sprint-state.json carrying the fields the check reads. */
function writeState(over = {}) {
  const state = {
    id: 'sprint-test-01',
    started_at: new Date(Date.now() - 120 * 60000).toISOString(),
    metrics: { completed_at: new Date(Date.now() - 10 * 60000).toISOString() },
    ...over,
  };
  const dir = path.join(tmpDir, '.sprint-state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sprint-state.json');
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return { file, state };
}

function capture(run) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  return Promise.resolve()
    .then(run)
    .then((code) => { console.log = orig; return { code, out: out.join('\n') }; },
      (err) => { console.log = orig; throw err; });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-rework-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpDir });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('handleReworkCheck', () => {
  it('says so when there are no closed sprints in the window', async () => {
    const { code, out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(code).toBe(0);
    expect(out).toContain('No closed sprints');
  });

  it('marks a sprint with no commits in its window as NOT MEASURABLE', async () => {
    writeState();
    const { code, out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(code).toBe(0);
    // The distinction the gate exists for: zero commits is "cannot tell", not
    // "0% rework".
    expect(out).toContain('NOT MEASURABLE');
    expect(out).not.toContain('All sprints within acceptable');
  });

  it('computes the rate from the sprint window and persists it', async () => {
    commit('feat: base', 100);
    commit('feat: work', 90);
    commit('fix: a bug', 80);
    commit('fix: another bug', 70);
    const { file } = writeState();

    const { code, out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(code).toBe(0);
    expect(out).toMatch(/\d+\.\d%/);

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.metrics.total_sprint_commits).toBeGreaterThan(0);
    expect(saved.metrics.rework_rate).toBeGreaterThan(0);
    // The denominator is persisted next to the rate so the next run can check
    // the number against its own evidence.
    expect(saved.metrics.fix_sprint_commits).toBeGreaterThanOrEqual(0);
  });

  it('raises an alert above the 30% threshold', async () => {
    commit('feat: one', 100);
    commit('fix: two', 90);
    commit('fix: three', 80);
    writeState();
    const { out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(out).toMatch(/exceeds 30% threshold|Rework rate alert/);
  });

  it('skips a sprint whose completed_at is outside the window', async () => {
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    writeState({ metrics: { completed_at: old } });
    const { code, out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(code).toBe(0);
    expect(out).toContain('No closed sprints');
  });

  it('ignores a malformed state file instead of throwing', async () => {
    const dir = path.join(tmpDir, '.sprint-state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sprint-state.json'), '{not json');
    const { code, out } = await capture(() => handleReworkCheck(tmpDir, 30));
    expect(code).toBe(0);
    expect(out).toContain('No closed sprints');
  });
});
