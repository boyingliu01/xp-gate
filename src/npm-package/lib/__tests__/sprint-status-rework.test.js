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
  const gitEnv = { ...process.env };
  for (const name of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
    'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
  ]) {
    delete gitEnv[name];
  }
  return execSync(`git ${cmd}`, {
    cwd: dir || TMP_DIR,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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

// A repository with identity already configured, built once per test FILE
// instead of once per test. `git init` plus two `git config` launches cost
// ~130 ms each on Windows and none of it is what these tests assert; copying the
// prepared tree is one filesystem operation instead of three process launches.
let _repoTemplate = null;

/** Build the template exactly once. Never copies from itself. */
function repoTemplate() {
  if (_repoTemplate) return _repoTemplate;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-template-'));
  git('init', dir);
  git('config user.email "test@test.com"', dir);
  git('config user.name "Test"', dir);
  _repoTemplate = dir;
  return dir;
}

/** Create a configured repo at `dir`, replacing the init + 2x config triple. */
function initRepo(dir) {
  fs.cpSync(repoTemplate(), dir, { recursive: true });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/**
 * Hour-level offset, needed to express a sprint window that actually CONTAINS
 * the fixture's commits (#704).
 *
 * The commits are made "now", so a window built from daysAgo(9)→daysAgo(2) held
 * no commits at all. The old fixtures compensated by hand-writing
 * `total_sprint_commits: 10` — a number nothing in the code ever produced — which
 * pinned the expected rate against a value that could only exist in the test.
 * Negative = in the future; used for `completed_at`, which in the real CLOSE
 * ordering is stamped after the last commit.
 */
function hoursAgo(n) {
  return new Date(Date.now() - n * 3600000).toISOString();
}

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-test-'));
  cwdSpy = vi.spyOn(process, 'cwd');
  // Build the shared repo template HERE, before any test mocks process.cwd().
  // repoTemplate() calls os.tmpdir(), which resolves through process.cwd(); once
  // cwdSpy is stubbing it to TMP_DIR, a lazily-created template would be made
  // inside TMP_DIR and then copied into itself.
  _repoTemplate = null;
  repoTemplate();
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

    initRepo(dir);
    // 10 commits, 2 of them fixes => 20%, below the 30% threshold.
    // The count has to come from real history: the old fixture made 3 commits
    // and declared 'total_sprint_commits: 10' by hand, so the expected 20%
    // could only ever be produced by the fabricated number (#704).
    makeCommit('feat: initial', dir);
    makeCommit('fix: resolve login bug', dir);
    makeCommit('fix(auth): handle timeout', dir);
    for (let i = 0; i < 7; i += 1) makeCommit(`feat: feature ${i}`, dir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-b',
      task_description: 'Sprint B',
      phase: 6,
      status: 'completed',
      started_at: hoursAgo(1),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: hoursAgo(-1) },
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

    initRepo(dir);
    // 10 commits, 5 of them fixes => 50%, above the 30% threshold.
    makeCommit('fix: one', dir);
    makeCommit('fix: two', dir);
    makeCommit('bugfix: three', dir);
    makeCommit('hotfix: four', dir);
    makeCommit('patch: five', dir);
    for (let i = 0; i < 5; i += 1) makeCommit(`feat: feature ${i}`, dir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-c',
      task_description: 'Sprint C',
      phase: 6,
      status: 'completed',
      started_at: hoursAgo(1),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: hoursAgo(-1) },
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

  test('(e) --dir takes precedence over inherited Git hook repository variables', async () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-target-'));
    const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-outer-'));

    for (const dir of [targetDir, outerDir]) {
      initRepo(dir);
    }
    makeCommit('feat: target initial', targetDir);
    makeCommit('fix: target bug', targetDir);
    // 8 more target commits => 10 total, 1 fix => 10%. The count must come from
    // real history; the old fixture declared it in the state file by hand, and
    // this test's actual subject is GIT_DIR precedence, not arithmetic (#704).
    for (let i = 0; i < 8; i += 1) makeCommit(`feat: target feature ${i}`, targetDir);
    makeCommit('fix: outer one', outerDir);
    makeCommit('fix: outer two', outerDir);
    makeCommit('fix: outer three', outerDir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-hook-env',
      task_description: 'Hook environment sprint',
      phase: 6,
      status: 'completed',
      started_at: hoursAgo(1),
      isolation: { worktree_path: null, branch: 'main' },
      phase_history: [],
      metrics: { completed_at: hoursAgo(-1) },
    }, targetDir);
    cwdSpy.mockReturnValue(targetDir);

    const previousGitDir = process.env.GIT_DIR;
    const previousWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = path.join(outerDir, '.git');
    process.env.GIT_WORK_TREE = outerDir;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await handleSprintStatus([
        '--rework-check', '--window-days', '7', '--dir', targetDir,
      ]);
      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');

      expect(code).toBe(0);
      expect(output).toContain('10.0%');
      expect(output).toContain('1 fix / 10 total commits');
    } finally {
      logSpy.mockRestore();
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousWorkTree;
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(outerDir, { recursive: true, force: true });
    }
  });

  test('(f) completed_at cannot inject shell commands into the Git log query', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-injection-'));
    const markerFile = path.join(dir, 'injection-marker');
    cwdSpy.mockReturnValue(dir);
    initRepo(dir);
    makeCommit('fix: target bug', dir);

    writeSprintState({
      _schema_version: 1,
      id: 'sprint-injection',
      phase: 6,
      status: 'completed',
      metrics: {
        completed_at: `Thu, 06 Aug 2026 00:00:00 GMT ("; touch ${markerFile}; #)`,
        total_sprint_commits: 1,
      },
    }, dir);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await handleSprintStatus(['--rework-check', '--window-days', '3650', '--dir', dir]);
      expect(code).toBe(0);
      expect(fs.existsSync(markerFile)).toBe(false);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
