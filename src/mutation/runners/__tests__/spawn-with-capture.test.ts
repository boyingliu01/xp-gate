/**
 * @test REQ-MUTATION-SPAWN
 * @intent 每个 mutation runner 都自己实现了一遍"起子进程 + 收集 stdout/stderr +
 *         超时先 SIGTERM 后 SIGKILL"。四份拷贝意味着超时语义有四处可能分叉——
 *         实测 2026-11-24：pitest / stryker / go-mutant / gremlins 之间有 116 行重复
 *         （jscpd，同一段 timeoutId + child.on('close') 骨架）。
 *
 *         抽出一处后，超时行为只有一个定义，测一遍等于测四个 runner。
 *
 * @covers AC-MUTATION-SPAWN-01
 * @covers AC-MUTATION-SPAWN-02
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnWithCapture } from '../spawn-with-capture';

describe('spawnWithCapture', () => {
  it('collects stdout, stderr and the exit code', async () => {
    const result = await spawnWithCapture(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(0);'],
      { timeoutMs: 10_000, cwd: process.cwd() },
    );
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('reports a non-zero exit code without throwing', async () => {
    const result = await spawnWithCapture(
      process.execPath,
      ['-e', 'process.exit(3);'],
      { timeoutMs: 10_000, cwd: process.cwd() },
    );
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('marks the run as timed out and kills the child', async () => {
    const result = await spawnWithCapture(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 60_000);'],
      { timeoutMs: 150, cwd: process.cwd() },
    );
    expect(result.timedOut).toBe(true);
    // A timed-out child has no exit code of its own to report.
    expect(result.code).toBeNull();
  });

  /**
   * @covers AC-MUTATION-SPAWN-02
   * A spawn that cannot even start must surface as an error result rather than
   * an unhandled rejection: the runners call this inside a Promise chain that
   * would otherwise reject and be swallowed by the caller's catch, turning a
   * broken toolchain into "no findings".
   */
  it('reports a spawn failure as an error result instead of rejecting', async () => {
    const result = await spawnWithCapture(
      '/nonexistent/binary-for-test',
      [],
      { timeoutMs: 5_000, cwd: process.cwd() },
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('does not leave a timer behind after a fast exit', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await spawnWithCapture(process.execPath, ['-e', 'process.exit(0);'], {
      timeoutMs: 60_000,
      cwd: process.cwd(),
    });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
