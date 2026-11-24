/**
 * @test REQ-SPRINT-INIT
 * @intent sprint-init.js 有 248 行，覆盖率为 0%：没有任何测试文件引用它。
 *         它是 `xp-gate sprint-init` 的实现，负责从分支名推导 sprint 标识、
 *         生成 ID、备份上一轮状态。这些行为每天都在用，却没有一条断言。
 *
 *         先锁住三个纯函数（分支检测、ID 生成、状态备份），它们不需要
 *         起 CLI 就能测；handleSprintInit 的端到端路径单独一组。
 *
 * @covers AC-SPRINT-INIT-01
 * @covers AC-SPRINT-INIT-02
 * @covers AC-SPRINT-INIT-03
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');


const { detectBranch, generateSprintId, backupSprintState } = require('../sprint-init.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-sprint-init-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectBranch', () => {
  it('returns the current branch name', () => {
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    execFileSync('git', ['checkout', '-q', '-b', 'sprint/test-branch'], { cwd: tmpDir });
    expect(detectBranch(tmpDir)).toBe('sprint/test-branch');
  });

  it('returns "unknown" when the directory is not a git repo', () => {
    // A missing repo must degrade to a value the caller can branch on, not throw:
    // sprint-init runs before anything else and cannot fail the whole command.
    expect(detectBranch(tmpDir)).toBe('unknown');
  });

  it('returns "detached" when HEAD is detached', () => {
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    // Identity via -c rather than `git config`: the latter writes a repo-local
    // config this fixture never needs again, and on a machine whose global
    // identity is unset the commit fails for a reason unrelated to the test.
    // `core.hooksPath=/dev/null` because this machine's global install makes the
    // quality gates run inside a fixture commit, which both takes minutes and
    // exercises hooks this test is not about.
    const identity = [
      '-c', 'user.email=t@example.com', '-c', 'user.name=T',
      '-c', 'core.hooksPath=/dev/null',
    ];
    execFileSync('git', [...identity, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: tmpDir });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();
    execFileSync('git', ['checkout', '-q', sha], { cwd: tmpDir });
    // `git branch --show-current` is empty on a detached HEAD; the empty string
    // must not reach the caller as a branch name.
    expect(detectBranch(tmpDir)).toBe('detached');
  });
});

describe('generateSprintId', () => {
  it('produces the documented shape', () => {
    expect(generateSprintId()).toMatch(/^sprint-\d{8}-\d{2}$/);
  });

  it('uses today as the date segment', () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(generateSprintId()).toContain(today);
  });

  it('zero-pads the sequence', () => {
    for (let i = 0; i < 20; i += 1) {
      const seq = generateSprintId().split('-')[2];
      expect(seq).toHaveLength(2);
      expect(Number(seq)).toBeGreaterThanOrEqual(1);
      expect(Number(seq)).toBeLessThanOrEqual(99);
    }
  });
});

describe('backupSprintState', () => {
  it('writes the state under .sprint-history/ and returns the path', () => {
    const state = { id: 'sprint-20260101-07', phase: 3 };
    const file = backupSprintState(tmpDir, state);
    expect(file).toContain(path.join('.sprint-history', 'sprint-state-sprint-20260101-07-'));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(state);
  });

  it('creates .sprint-history when it does not exist', () => {
    expect(fs.existsSync(path.join(tmpDir, '.sprint-history'))).toBe(false);
    backupSprintState(tmpDir, { id: 'x' });
    expect(fs.existsSync(path.join(tmpDir, '.sprint-history'))).toBe(true);
  });

  it('reuses an existing .sprint-history instead of failing', () => {
    fs.mkdirSync(path.join(tmpDir, '.sprint-history'), { recursive: true });
    expect(() => backupSprintState(tmpDir, { id: 'y' })).not.toThrow();
  });

  it('falls back to "unknown" when the state carries no id', () => {
    const file = backupSprintState(tmpDir, { phase: 1 });
    expect(path.basename(file)).toContain('sprint-state-unknown-');
  });
});

describe('handleSprintInit', () => {
  const { handleSprintInit } = require('../sprint-init.js');

  /** Silence and capture what a handler printed. */
  function capture(run) {
    const out = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => out.push(a.join(' '));
    return Promise.resolve(run()).then(
      (code) => { console.log = origLog; console.error = origErr; return { code, out: out.join('\n') }; },
      (err) => { console.log = origLog; console.error = origErr; throw err; },
    );
  }

  beforeEach(() => {
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    execFileSync('git', ['checkout', '-q', '-b', 'sprint/fixture'], { cwd: tmpDir });
  });

  it('prints usage and exits 0 for --help', async () => {
    const { code, out } = await capture(() => handleSprintInit(['--help']));
    expect(code).toBe(0);
    expect(out).toContain('sprint-init');
    expect(out).toContain('--force');
  });

  it('fails when the task description is missing', async () => {
    const { code, out } = await capture(() => handleSprintInit(['--dir', tmpDir]));
    expect(code).toBe(1);
    expect(out).toContain('Missing task_description');
  });

  it('creates a sprint state on a clean project', async () => {
    const { code } = await capture(() => handleSprintInit(['Build the thing', '--dir', tmpDir]));
    expect(code).toBe(0);
    const statePath = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state.task_description).toBe('Build the thing');
  });

  it('is idempotent for the same task on the same branch', async () => {
    await capture(() => handleSprintInit(['Same task', '--dir', tmpDir]));
    const { code, out } = await capture(() => handleSprintInit(['Same task', '--dir', tmpDir]));
    expect(code).toBe(0);
    expect(out).toContain('already initialized');
  });

  it('refuses a conflicting active sprint without --force', async () => {
    await capture(() => handleSprintInit(['First', '--dir', tmpDir]));
    const { code, out } = await capture(() => handleSprintInit(['Second', '--dir', tmpDir]));
    expect(code).toBe(1);
    expect(out).toContain('already exists');
  });

  it('backs up the previous state and overrides with --force', async () => {
    await capture(() => handleSprintInit(['First', '--dir', tmpDir]));
    const { code, out } = await capture(() => handleSprintInit(['Second', '--dir', tmpDir, '--force']));
    expect(code).toBe(0);
    expect(out).toContain('Backed up');
    const history = fs.readdirSync(path.join(tmpDir, '.sprint-history'));
    expect(history.length).toBeGreaterThan(0);
  });

  it('reports a deny decision in --dry-run when a sprint is active', async () => {
    await capture(() => handleSprintInit(['First', '--dir', tmpDir]));
    const { code, out } = await capture(
      () => handleSprintInit(['Second', '--dir', tmpDir, '--dry-run']),
    );
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ decision: 'deny' });
  });

  it('reports an allow decision in --dry-run on a clean project without writing', async () => {
    const { code, out } = await capture(
      () => handleSprintInit(['Fresh', '--dir', tmpDir, '--dry-run']),
    );
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ decision: 'allow' });
    // Dry-run must not create state: that is the whole point of the flag.
    expect(fs.existsSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json'))).toBe(false);
  });

  it('records the issue list when --issues is given', async () => {
    await capture(() => handleSprintInit(['With issues', '--issues', '#1,#2', '--dir', tmpDir]));
    const state = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json'), 'utf8'),
    );
    expect(JSON.stringify(state)).toContain('#1');
  });
});
