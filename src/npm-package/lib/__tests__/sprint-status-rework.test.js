/**
 * TDD: written RED first (Phase G per design §12)
 * @test REQ-REWORK-001 Sprint rework rate tracking (#369)
 * @intent Validate xp-gate sprint-status --rework-check computes rework rate for closed sprints
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const { handleSprintStatus } = require('../sprint-status');

let TMP_DIR;
let cwdSpy;

function git(cmd, dir) {
  return execSync(`git ${cmd}`, { cwd: dir || TMP_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function writeSprintState(state, dir) {
  const sd = path.join(dir || TMP_DIR, '.sprint-state');
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'sprint-state.json'), JSON.stringify(state, null, 2));
}

function writeHistoryFile(name, state, dir) {
  const hd = path.join(dir || TMP_DIR, '.sprint-state', 'sprint-history');
  fs.mkdirSync(hd, { recursive: true });
  fs.writeFileSync(path.join(hd, name), JSON.stringify(state, null, 2));
}

function makeCommit(msg, dir) {
  const d = dir || TMP_DIR;
  fs.appendFileSync(path.join(d, 'file.txt'), `${msg}-${Date.now()}\n`);
  git('add -A', d);
  git(`commit --no-verify -m "${msg}"`, d);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-test-'));
  cwdSpy = vi.spyOn(process, 'cwd');
});

beforeEach(() => {
  cwdSpy.mockReturnValue(TMP_DIR);
});

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('sprint-status --rework-check (#369)', () => {
  // TDD: written RED first (G phase per design §12)
  test('(a) no closed sprints → exit 0 + graceful message', async () => {
    writeSprintState({
      _schema_version: 1,
      id: 'sprint-open',
      task_description: 'Open sprint',
      phase: 3,
      status: 'in_progress',
      started_at: daysAgo(1),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: {},
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleSprintStatus(['--rework-check', '--window-days', '7', '--dir', TMP_DIR]);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('No closed sprints within');
  });

  // TDD: written RED first (G phase per design §12)
  test('(b) 2 fix / 10 total → rework_rate 0.2, no alert, state file updated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-b-'));
    cwdSpy.mockReturnValue(dir);

    git('init', dir);
    git('config user.email "test@test.com"', dir);
    git('config user.name "Test"', dir);
    makeCommit('feat: initial', dir);
    makeCommit('fix: resolve login bug', dir);
    makeCommit('fix(auth): handle timeout', dir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-b',
      task_description: 'Sprint B',
      phase: 6,
      status: 'completed',
      started_at: daysAgo(9),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: daysAgo(2), total_sprint_commits: 10 },
    }, dir);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleSprintStatus(['--rework-check', '--window-days', '7', '--dir', dir]);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('20.0%');
    expect(output).not.toContain('⚠️');

    const updated = JSON.parse(
      fs.readFileSync(path.join(dir, '.sprint-state', 'sprint-state.json'), 'utf8')
    );
    expect(updated.metrics.rework_rate).toBeCloseTo(0.2, 1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // TDD: written RED first (G phase per design §12)
  test('(c) 5 fix / 10 total → rework_rate 0.5, alert printed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-c-'));
    cwdSpy.mockReturnValue(dir);

    git('init', dir);
    git('config user.email "test@test.com"', dir);
    git('config user.name "Test"', dir);
    makeCommit('fix: one', dir);
    makeCommit('fix: two', dir);
    makeCommit('bugfix: three', dir);
    makeCommit('hotfix: four', dir);
    makeCommit('patch: five', dir);
    makeCommit('feat: six', dir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-c',
      task_description: 'Sprint C',
      phase: 6,
      status: 'completed',
      started_at: daysAgo(9),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: daysAgo(2), total_sprint_commits: 10 },
    }, dir);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleSprintStatus(['--rework-check', '--window-days', '7', '--dir', dir]);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('50.0%');
    expect(output).toContain('⚠️');
    expect(output).toContain('sprint-c');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // TDD: written RED first (G phase per design §12)
  test('(d) --window-days 1 filters out sprints closed >1 day ago', async () => {
    writeHistoryFile('sprint-old.json', {
      _schema_version: 1,
      id: 'sprint-old',
      task_description: 'Old sprint',
      phase: 6,
      status: 'completed',
      started_at: daysAgo(20),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: daysAgo(10), total_sprint_commits: 10 },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleSprintStatus(['--rework-check', '--window-days', '1', '--dir', TMP_DIR]);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('No closed sprints within 1 day');
  });
});
