/**
 * @test REQ-CHECK-CHANGED
 * @intent `--changed` 决定哪些文件会被检查。它的失败模式是**静默的**：拿不到
 *         变更列表时如果返回空数组，下游会"检查 0 个文件"并打印通过——正是本
 *         项目反复禁止的 "vacuous pass"。
 *
 *         所以契约是：**不是 git 仓库 → null**（调用方据此报告），而不是 []。
 *
 *         范围与 pre-commit 一致：先看暂存区，暂存区为空再看 vs HEAD。
 *
 * @covers AC-CHECK-CHANGED-01
 * @covers AC-CHECK-CHANGED-02
 * @covers AC-CHECK-CHANGED-03
 */
import { describe, expect, it } from 'vitest';

const { gitChangedNames, readChangedFiles } = require('../check.js');

/** A spawnSync stand-in: returns a canned result per command line. */
function fakeSpawn(map) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = args.slice(0, 2).join(' ');
    if (!(key in map)) return { status: 0, stdout: '' };
    return map[key];
  };
  fn.calls = calls;
  return fn;
}

describe('gitChangedNames', () => {
  it('splits stdout into trimmed, non-empty file names', () => {
    const spawn = fakeSpawn({ 'diff --cached': { status: 0, stdout: ' a.js\n\n b.js \n' } });
    expect(gitChangedNames(spawn, ['diff', '--cached', '--name-only'])).toEqual(['a.js', 'b.js']);
  });

  it('returns null for a failed diff, not an empty list', () => {
    // The whole point: "not a git repository" must not look like "no changes".
    const spawn = fakeSpawn({ 'diff --cached': { status: 128, stdout: '' } });
    expect(gitChangedNames(spawn, ['diff', '--cached', '--name-only'])).toBeNull();
  });

  it('returns null when spawn throws', () => {
    const spawn = () => { throw new Error('ENOENT git'); };
    expect(gitChangedNames(spawn, ['diff', '--cached'])).toBeNull();
  });

  it('returns null when stdout is not a string', () => {
    // A buffered result would otherwise be `.split is not a function`.
    const spawn = fakeSpawn({ 'diff --cached': { status: 0, stdout: Buffer.from('a.js') } });
    expect(gitChangedNames(spawn, ['diff', '--cached'])).toBeNull();
  });

  it('returns an empty list (not null) for a successful diff with no changes', () => {
    const spawn = fakeSpawn({ 'diff --cached': { status: 0, stdout: '' } });
    expect(gitChangedNames(spawn, ['diff', '--cached'])).toEqual([]);
  });
});

describe('readChangedFiles', () => {
  // `readChangedFiles` requires `child_process` lazily and cannot be injected, so it
  // is not testable without either mocking the module or running in a fixture repo.
  // Rather than assert a tautology that always passes, the staging-then-HEAD ORDER is
  // stated here as a known gap rather than pretended to be covered.
  it.todo('prefers the staged set when it is non-empty');
  it.todo('falls back to the working set versus HEAD when nothing is staged');
});
