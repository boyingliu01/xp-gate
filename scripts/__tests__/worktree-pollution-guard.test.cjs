/**
 * @test REQ-428 worktree pollution guard
 * @intent 全量测试运行结束后，工作树不得出现基线快照之外的新改动（#428 症状 B 的回归防线）。
 *         guard 只比较运行前后的 `git status --porcelain` 差集，因此开发者自己的
 *         未提交改动不会误报，只有测试写进仓库的文件才会。
 * @covers AC-428-01, AC-428-02, AC-428-03, AC-428-04, AC-428-05, AC-428-06, AC-428-07
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const guard = require('../vitest-worktree-guard.cjs');

describe('worktree pollution guard (#428 symptom B)', () => {
  let repo;

  function git(args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  }

  function initRepo() {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-worktree-guard-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'XP-Gate Test']);
    fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repo, 'preexisting.ts'), 'export const b = 1;\n');
    git(['add', 'tracked.ts', 'preexisting.ts']);
    git(['-c', 'core.hooksPath=', 'commit', '-qm', 'initial']);
  }

  beforeEach(initRepo);

  afterEach(() => {
    if (repo && fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });
  });

  it('AC-428-01: parses modified, untracked and renamed porcelain lines', () => {
    const parsed = guard.parsePorcelain(
      [' M tracked.ts', '?? new-file.sh', 'R  old.ts -> new.ts'].join('\n')
    );
    expect(parsed).toEqual([
      { status: 'M', file: 'tracked.ts' },
      { status: '?', file: 'new-file.sh' },
      { status: 'R', file: 'new.ts' },
    ]);
  });

  it('AC-428-02: keeps paths that were already dirty before the run out of the report', () => {
    fs.appendFileSync(path.join(repo, 'preexisting.ts'), 'export const c = 2;\n');
    const baseline = guard.snapshotStatus(repo);
    // Same path dirtied further, plus a path the run introduced.
    fs.appendFileSync(path.join(repo, 'preexisting.ts'), 'export const c2 = 3;\n');
    fs.writeFileSync(path.join(repo, 'introduced.ts'), 'export const f = 5;\n');
    expect(guard.findNewEntries(baseline, guard.snapshotStatus(repo))).toEqual([
      { status: '?', file: 'introduced.ts' },
    ]);
  });

  it('AC-428-03: reports a tracked file the run modified', () => {
    const baseline = guard.snapshotStatus(repo);
    fs.appendFileSync(path.join(repo, 'tracked.ts'), 'export const d = 3;\n');
    expect(guard.findNewEntries(baseline, guard.snapshotStatus(repo))).toEqual([
      { status: 'M', file: 'tracked.ts' },
    ]);
  });

  it('AC-428-04: reports a file the run left behind untracked', () => {
    const baseline = guard.snapshotStatus(repo);
    fs.writeFileSync(path.join(repo, 'leftover.json'), '{}\n');
    expect(guard.findNewEntries(baseline, guard.snapshotStatus(repo))).toEqual([
      { status: '?', file: 'leftover.json' },
    ]);
  });

  it('AC-428-05: teardown fails and names the polluted path', async () => {
    const baseline = guard.snapshotStatus(repo);
    fs.writeFileSync(path.join(repo, 'synced-by-test.ts'), 'export const e = 4;\n');
    await expect(
      guard.runTeardown({ cwd: repo, baseline, skip: false })
    ).rejects.toThrow(/synced-by-test\.ts/);
  });

  it('AC-428-06: an explicit opt-out downgrades the failure to a warning', async () => {
    const baseline = guard.snapshotStatus(repo);
    fs.writeFileSync(path.join(repo, 'synced-by-test.ts'), 'export const e = 4;\n');
    await expect(
      guard.runTeardown({ cwd: repo, baseline, skip: true })
    ).resolves.toBeUndefined();
  });

  it('AC-428-07: a nested working directory is not the top level, so the guard no-ops', async () => {
    fs.mkdirSync(path.join(repo, 'nested'), { recursive: true });
    const insideSubdir = guard.isWorktreeTopLevel(path.join(repo, 'nested'));
    expect(insideSubdir).toBe(false);
    expect(guard.isWorktreeTopLevel(repo)).toBe(true);
  });

  it('AC-428-08: the vitest entry point passes against this repository mid-edit', async () => {
    // The guard is wired into every `vitest run`, so it must tolerate the
    // developer's own uncommitted files. `worktree-pollution-guard.test.cjs`
    // itself is untracked while this test executes.
    const teardown = await guard.worktreeGuard();
    expect(typeof teardown).toBe('function');
    await expect(teardown()).resolves.toBeUndefined();
  });
});
