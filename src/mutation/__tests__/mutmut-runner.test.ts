/**
 * @test REQ-MUT-007 mutmut mutation runner
 * @intent Verify MutmutRunner registration, availability checks, emoji progress parsing,
 *         pyproject.toml config management, and cleanup behavior
 * @covers AC-MUT-007, AC-MUT-008
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'child_process';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { shouldEscalate } from '../runners/spawn-with-capture';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe('MutmutRunner', () => {
  let MutmutRunner: typeof import('../runners/mutmut-runner').MutmutRunner;
  let tmpDir: string;

  /**
   * Wait until the runner has actually spawned the child process.
   *
   * `run()` awaits `isAvailable()` when the platform is win32 (the route is
   * resolved via a version probe), so `spawn` is NOT called synchronously with
   * `run()`. Calling `stdoutCb` right after `run()` therefore raced on Windows:
   * the callback had not been captured yet and the test threw
   * `stdoutCb is not a function`. Linux skipped the await entirely, which is why
   * CI stayed green while the same suite failed locally.
   */
  /**
   * Start a run, advance the fake clock, and return the settled result.
   *
   * The advance must happen BEFORE awaiting: the fake child only emits `close` after the
   * clock moves, so awaiting first would deadlock.
   */
  async function runAndAdvance(platform: NodeJS.Platform, timeoutMs: number, advanceMs: number) {
    const pending = new MutmutRunner(platform).run({
      files: ['src/main.py'],
      timeoutMs,
      cwd: tmpDir,
    });
    await vi.advanceTimersByTimeAsync(advanceMs);
    return pending;
  }

  /** The `run()` options every test in this file uses. */
  function opts(files: string[], timeoutMs: number, cwd: string) {
    return { files, timeoutMs, cwd };
  }

  /**
   * Wait for the spawn, deliver the exit code, and return the settled result.
   *
   * The ORDER is the point: the fake child's callbacks only exist after `spawn` runs,
   * so delivering `close` first would reach nothing.
   */
  async function finish<T>(close: ((code: number | null) => void) | null, code: number, promise: Promise<T>): Promise<T> {
    await waitForSpawn();
    close!(code);
    return promise;
  }

  /**
   * Make native mutmut unavailable but the WSL route work.
   *
   * Eleven WSL tests need exactly this pair: `mutmut --version` fails (no native
   * install) while `wsl mutmut --version` succeeds. Naming it keeps each test down to
   * the line that differs.
   */
  function mockMutmutOnlyOnWsl(): void {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === 'mutmut --version') throw new Error('command not found: mutmut');
      return 'mutmut, version 3.0.0\n';
    });
  }

  /** Native mutmut works; the WSL route does not. */
  function mockMutmutNativeOnly(): void {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === 'mutmut --version') return 'mutmut, version 3.0.0\n';
      throw new Error('WSL unavailable');
    });
  }

  /**
   * A `win32` runner that has just probed itself available.
   *
   * Fifteen WSL tests open with the same three statements -- install the fake, construct
   * the runner, assert it found the WSL route -- before doing anything of their own.
   */
  async function wslRunnerReady(child: ChildProcess) {
    vi.mocked(spawn).mockReturnValue(child);
    const runner = new MutmutRunner('win32');
    await runner.isAvailable();
    return runner;
  }

  async function waitForSpawn(): Promise<void> {
    for (let i = 0; i < 50 && !vi.mocked(spawn).mock.calls.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * Build a fake child process whose `stdout`/`close` callbacks are captured so a
   * test can drive them by hand. Shared because every spawn-based test needs the
   * same shape, and inlining it in each one pushed those callbacks past the
   * function-length rule.
   */
  /**
   * Build the `on(event, cb)` handler the fake child exposes.
   *
   * Split out of `mockChildProcess` when the deferred variants pushed it past the length
   * ceiling. The error listener receives an Error rather than an exit code, hence the
   * cast that lets one handler serve both events.
   */
  function makeOnHandler(
    capture: {
      deferredClose?: { code: number | null; delayMs: number };
      deferredError?: { message: string; delayMs: number };
      close?: (cb: (code: number | null) => void) => void;
      onClose?: (emit: { stderr: (d: Buffer) => void; close: (code: number) => void }) => void;
    },
    remember: (cb: (code: number | null) => void) => void,
    stderrOf: () => ((d: Buffer) => void) | null,
  ) {
    return (event: string, cb: (code: number | null) => void) => {
      if (event === 'error' && capture.deferredError) {
        const { message, delayMs } = capture.deferredError;
        setTimeout(() => (cb as unknown as (e: Error) => void)(new Error(message)), delayMs);
        return;
      }
      if (event !== 'close') return;
      if (capture.deferredClose) {
        const { code, delayMs } = capture.deferredClose;
        setTimeout(() => cb(code), delayMs);
        return;
      }
      remember(cb);
      capture.close?.(cb);
      capture.onClose?.({ stderr: (d) => stderrOf()?.(d), close: (code) => cb(code) });
    };
  }

  function mockChildProcess(capture: {
    /** Deliver `close(code)` after this many ms, instead of synchronously. */
    deferredClose?: { code: number | null; delayMs: number };
    /** Deliver an `error` event after this many ms. */
    deferredError?: { message: string; delayMs: number };
    /** Called on every `kill()`, so a test can model a child that dies on the signal. */
    onKill?: (signal: string) => void;
    stdout?: (cb: (d: Buffer) => void) => void;
    stderr?: (cb: (d: Buffer) => void) => void;
    close?: (cb: (code: number | null) => void) => void;
    /** Run when `close` is subscribed, instead of the test driving it by hand. */
    onClose?: (emit: { stderr: (d: Buffer) => void; close: (code: number) => void }) => void;
  }) {
    let stderrCb: ((d: Buffer) => void) | null = null;
    const child: ChildProcess = {
      stdout: {
        on: vi.fn((_event: string, cb: (d: Buffer) => void) => capture.stdout?.(cb)),
      },
      stderr: {
        on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
          stderrCb = cb;
          capture.stderr?.(cb);
        }),
      },
      on: vi.fn(makeOnHandler(capture, () => {}, () => stderrCb)),
      kill: vi.fn((signal: string) => {
        capture.onKill?.(signal);
        return true;
      }),
      killed: false,
      // A live pid: the escalation refuses to signal a child that is gone, and a fake
      // without one models "already reaped".
      pid: 4242,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    return child;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockReset();
    vi.mocked(spawn).mockReset();
    vi.mocked(execSync).mockReturnValue('mutmut, version 3.0.0\n');
    // The default for every test: no pyproject.toml unless the test says so.
    vi.mocked(existsSync).mockReturnValue(false);
    // The default for every test: no pyproject.toml on disk unless the test says so.
    tmpDir = join(tmpdir(), `xp-gate-mutmut-test-${Date.now()}`);
    MutmutRunner = (await import('../runners/mutmut-runner')).MutmutRunner;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('name and extensions', () => {
    it('should have name "mutmut"', () => {
      const runner = new MutmutRunner();
      expect(runner.name).toBe('mutmut');
    });

    it('should handle .py extension', () => {
      const runner = new MutmutRunner();
      expect(runner.extensions).toContain('py');
      expect(runner.extensions).not.toContain('ts');
      expect(runner.extensions).not.toContain('go');
    });
  });

  describe('isAvailable', () => {
    it('should return true when mutmut is installed', async () => {
      vi.mocked(execSync).mockReturnValue('mutmut, version 3.0.0\n');

      const runner = new MutmutRunner('linux');
      const result = await runner.isAvailable();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('mutmut --version', {
        stdio: 'pipe',
        timeout: 5000,
      });
    });

    it('should return false when mutmut is not installed', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found: mutmut');
      });

      const runner = new MutmutRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });

    it('should use WSL when native mutmut is unavailable on Windows', async () => {
      mockMutmutOnlyOnWsl();

      const runner = new MutmutRunner('win32');
      const result = await runner.isAvailable();

      expect(result).toBe(true);
      // #410: win32 route is decided by the WSL probe alone (no native probe).
      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith('wsl mutmut --version', {
        stdio: 'pipe',
        timeout: 10000,
      });
    });

    it('should keep native detection unchanged on non-Windows platforms', async () => {
      vi.mocked(execSync).mockReturnValue('mutmut, version 3.0.0\n');

      const runner = new MutmutRunner('linux');
      const result = await runner.isAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith('mutmut --version', {
        stdio: 'pipe',
        timeout: 5000,
      });
    });

    it('should report unavailable when native mutmut and WSL are unavailable', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      const runner = new MutmutRunner('win32');
      const result = await runner.isAvailable();

      expect(result).toBe(false);
      const outcome = await runner.run(opts(['src/main.py'], 60000, tmpDir));

      expect(outcome).toEqual({ report: null, timedOut: false });
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('should spawn mutmut run and parse emoji progress', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      vi.mocked(spawn).mockReturnValue(
        mockChildProcess({
          stdout: cb => { stdoutCb = cb; },
          close: cb => { closeCb = cb; },
        }),
      );

      // No existing pyproject.toml

      const runner = new MutmutRunner('linux');
      const promise = runner.run(opts(['src/main.py'], 60000, tmpDir));

      // Simulate stdout with emoji progress. One wait covers both callbacks --
      // they are captured by the same spawn invocation.
      const progressOutput =
        '38/38  🎉 9 🫥 29  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0\n';
      await waitForSpawn();
      stdoutCb!(Buffer.from(progressOutput));
      closeCb!(0);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'mutmut',
        ['run'],
        expect.objectContaining({ cwd: tmpDir }),
      );
      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBeCloseTo(23.68, 1); // 9/38 * 100
      expect(result.report!.nrOfMutants).toBe(38);
      expect(result.report!.nrOfKilledMutants).toBe(9);
      expect(result.report!.nrOfSurvivedMutants).toBe(29);
    });

    it('should be unavailable on Windows when WSL is absent even if native mutmut is installed', async () => {
      const mockChild = mockChildProcess({});
      mockMutmutNativeOnly();
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new MutmutRunner('win32');
      // #410: native mutmut on Windows proves nothing about `mutmut run`
      // (fork()-based). The WSL route decides availability; no WSL → SKIP.
      expect(await runner.isAvailable()).toBe(false);
      const outcome = await runner.run(opts(['src/main.py'], 60000, 'C:\\work\\project'));

      expect(outcome).toEqual({ report: null, timedOut: false });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should execute selected WSL route with Linux --cd and Windows host cwd', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      mockMutmutOnlyOnWsl();
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run(opts(['src/main.py'], 60000, 'C:\\work\\project'));
      await finish(closeCb, 0, promise);

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/c/work/project', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'C:\\work\\project' }),
      );
      // Explicit `shell: false` == omitting the key; same semantics, assert the value.
      expect(vi.mocked(spawn).mock.calls[0]?.[2]).toHaveProperty('shell', false);
    });

    it('should preserve spaced and metacharacter paths as one WSL argv item', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      mockMutmutOnlyOnWsl();
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run(opts(['src/main.py'], 60000, 'C:\\work dir\\safe; echo injected'));
      await finish(closeCb, 0, promise);

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/c/work dir/safe; echo injected', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'C:\\work dir\\safe; echo injected' }),
      );
      // Explicit `shell: false` == omitting the key; same semantics, assert the value.
      expect(vi.mocked(spawn).mock.calls[0]?.[2]).toHaveProperty('shell', false);
    });

    it.each([
      ['uppercase drive', 'C:\\Work\\Project', '/mnt/c/Work/Project'],
      ['forward slash drive', 'D:/Work/Project', '/mnt/d/Work/Project'],
    ])('should convert %s paths for WSL', async (_name, windowsPath, linuxPath) => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      mockMutmutOnlyOnWsl();
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: windowsPath });
      await finish(closeCb, 0, promise);

      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['--cd', linuxPath, 'mutmut', 'run']);
    });

    it.each(['relative/project', '\\\\server\\share\\project'])(
      'should fail closed for non-drive WSL path %s', async (cwd) => {
        vi.mocked(execSync).mockImplementation((command) => {
          if (command === 'mutmut --version') throw new Error('native unavailable');
          return 'mutmut, version 3.0.0\n';
        });

        const runner = new MutmutRunner('win32');
        expect(await runner.isAvailable()).toBe(true);
        const outcome = await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd });

        expect(outcome).toEqual({ report: null, timedOut: false });
        expect(spawn).not.toHaveBeenCalled();
      },
    );

    it('should follow repeated native to WSL availability transitions', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      let nativeAvailable = true;
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version' && nativeAvailable) return 'native';
        if (command === 'wsl mutmut --version') return 'wsl';
        throw new Error('unavailable');
      });
      const runner = await wslRunnerReady(mockChild);
      nativeAvailable = false;
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });
      await finish(closeCb, 0, promise);

        expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('wsl');
    });

    it('should keep the WSL route on Windows even when native mutmut becomes available', async () => {
      const mockChild = mockChildProcess({ close: cb => cb(0) });
      let nativeAvailable = false;
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version' && nativeAvailable) return 'native';
        if (command === 'wsl mutmut --version') return 'wsl';
        throw new Error('unavailable');
      });
      const runner = await wslRunnerReady(mockChild);
      nativeAvailable = true;
      // #410: even when native `mutmut --version` starts succeeding, the win32
      // route is decided by WSL alone — native success proves nothing about
      // `mutmut run` (fork()). The route must NOT flip to native.
      expect(await runner.isAvailable()).toBe(true);
      await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });

      expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('wsl');
    });

    it('should stop spawning after availability transitions to unavailable', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('unavailable');
      });

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(false);
      const outcome = await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });

      expect(outcome).toEqual({ report: null, timedOut: false });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should clear timers when the child closes before timeout', async () => {
      vi.useFakeTimers();
      const mockChild = mockChildProcess({ deferredClose: { code: 0, delayMs: 10 } });

      const result = await runAndAdvance('linux', 100, 20);

      expect(result.timedOut).toBe(false);
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should clear timers when the child emits an error', async () => {
      vi.useFakeTimers();
      // Explicit rather than via the factory: this exercises the `error` EVENT path,
      // whose listener receives an Error instead of an exit code.
      let errorCb: ((e: Error) => void) | null = null;
      const mockChild = mockChildProcess({});
      vi.mocked(spawn).mockReturnValue({
        ...(mockChild as unknown as Record<string, unknown>),
        on: vi.fn((event: string, cb: (e: Error) => void) => {
          if (event === 'error') errorCb = cb;
        }),
      } as unknown as ChildProcess);

      const pending = new MutmutRunner('linux').run(opts(['src/main.py'], 100, tmpDir));
      await vi.advanceTimersByTimeAsync(20);
      errorCb!(new Error('spawn failed'));
      const result = await pending;

      expect(result.error).toBe('spawn failed');
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should report timeout when the timed-out process closes with a code', async () => {
      vi.useFakeTimers();
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'wsl';
      });
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 100, cwd: 'C:\\repo' });
      await vi.advanceTimersByTimeAsync(100);
      await waitForSpawn();
      closeCb!(1);
      const outcome = await promise;

      expect(outcome.timedOut).toBe(true);
    });

    it('should escalate to SIGKILL when SIGTERM does not close the child', async () => {
      vi.useFakeTimers();
      let closeCb: ((code: number | null) => void) | null = null;
      let killCount = 0;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; },
        onKill: () => { killCount += 1; if (killCount === 2) closeCb?.(null); } });
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'wsl';
      });
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 100, cwd: 'C:\\repo' });
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockChild.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(mockChild.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      await promise;
    });

    it('should kill the selected WSL process and report timeout', async () => {
      vi.useFakeTimers();
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; },
        onKill: () => closeCb?.(null) });
      mockMutmutOnlyOnWsl();
      const runner = await wslRunnerReady(mockChild);
      const promise = runner.run(opts(['src/main.py'], 100, 'D:\\repo'));
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/d/repo', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'D:\\repo' }),
      );
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toEqual({ report: null, timedOut: true });
      // Not `getTimerCount() === 0`: fake timers also count the harness's own. Cleanup is
      // proven by the promise SETTLING -- an armed escalation would keep it pending.
      expect(result.timedOut).toBe(true);
    });

    it('reports a null exit code as timedOut even when our timer never fired', async () => {
      mockChildProcess({ deferredClose: { code: null, delayMs: 10 } });

      const runner = new MutmutRunner();
      const result = await runner.run(opts(['src/main.py'], 100, tmpDir));

      // Deliberate change: was `didTimeOut()`, so an EXTERNALLY killed child read as
      // "completed without a report". A null exit code means no verdict was obtained.
      expect(result.timedOut).toBe(true);
      expect(result.report).toBeNull();
    });

    it('should return error when spawn fails', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('spawn mutmut ENOENT')), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new MutmutRunner();
      const result = await runner.run(opts(['src/main.py'], 60000, tmpDir));

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('spawn mutmut ENOENT');
    });

    it('should return error message when exit code is non-zero', async () => {
      // The stderr line and the non-zero exit must arrive together, so the
      // factory emits both as soon as the runner subscribes to `close`.
      vi.mocked(spawn).mockReturnValue(
        mockChildProcess({
          onClose: emit => {
            setTimeout(() => {
              emit.stderr(Buffer.from('mutation failed'));
              emit.close(1);
            }, 10);
          },
        }),
      );

      const runner = new MutmutRunner();
      const result = await runner.run(opts(['src/main.py'], 60000, tmpDir));

      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('mutation failed');
    });
  });

  describe('emoji progress parsing', () => {
    it('should parse standard progress line with all emojis', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = mockChildProcess({
        stdout: cb => { stdoutCb = cb; },
        close: cb => { closeCb = cb; },
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new MutmutRunner();
      const promise = runner.run(opts(['src/calc.py'], 60000, tmpDir));

      const output = '20/20  🎉 10 🫥 5  ⏰ 2  🤔 1  🙁 2  🔇 0  🧙 0\n';
      await waitForSpawn();
      stdoutCb!(Buffer.from(output));
      closeCb!(0);

      const result = await promise;
      expect(result.report).not.toBeNull();
      // killed=10, survived=5+2+1+2+0+0=10, total=20
      expect(result.report!.nrOfKilledMutants).toBe(10);
      expect(result.report!.nrOfSurvivedMutants).toBe(10);
      expect(result.report!.nrOfMutants).toBe(20);
      expect(result.report!.mutationScore).toBe(50);
    });

    it('should return null report when no progress line found', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = mockChildProcess({
        stdout: cb => { stdoutCb = cb; },
        close: cb => { closeCb = cb; },
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));

      await waitForSpawn();

      stdoutCb!(Buffer.from('Some random output without emoji\n'));
      await waitForSpawn();
      closeCb!(0);
      const result = await promise;
      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return null report when all mutant counts are zero', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = mockChildProcess({
        stdout: cb => { stdoutCb = cb; },
        close: cb => { closeCb = cb; },
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));

      const output = '0/0  🎉 0 🫥 0  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0\n';
      await waitForSpawn();
      stdoutCb!(Buffer.from(output));
      closeCb!(0);

      const result = await promise;
      expect(result.report).toBeNull();
    });
  });

  describe('pyproject.toml config writing', () => {
    it('should create new pyproject.toml when file does not exist', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new MutmutRunner();
      const promise = runner.run(opts(['src/main.py', 'src/utils.py'], 60000, tmpDir));
      await finish(closeCb, 0, promise);

      // Should have written pyproject.toml with source_paths
      expect(writeFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml'),
        expect.stringContaining('[tool.mutmut]'),
        { encoding: 'utf-8' },
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml'),
        expect.stringContaining('source_paths = ["src"]'),
        { encoding: 'utf-8' },
      );
    });

    it('should update existing pyproject.toml with [tool.mutmut] section', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      // First call for pyproject.toml exists check, second for backup
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml')) return true;
        if (p.endsWith('.xp-gate-backup')) return false;
        return false;
      });
      vi.mocked(readFileSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml')) {
          return '[tool.mutmut]\nsource_paths = ["old_path"]\n';
        }
        return '';
      });

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));
      await finish(closeCb, 0, promise);

      // Should have backed up and then written updated config
      expect(writeFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml.xp-gate-backup'),
        '[tool.mutmut]\nsource_paths = ["old_path"]\n',
        { encoding: 'utf-8' },
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml'),
        expect.stringContaining('source_paths = ["src"]'),
        { encoding: 'utf-8' },
      );
    });

    it('should append [tool.mutmut] section to existing file without it', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      vi.mocked(existsSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml')) return true;
        if (p.endsWith('.xp-gate-backup')) return false;
        return false;
      });
      vi.mocked(readFileSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml')) {
          return '[tool.pytest]\ntestpaths = ["tests"]\n';
        }
        return '';
      });

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));
      await finish(closeCb, 0, promise);

      // Should have appended [tool.mutmut] section
      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      const configWrite = writeCalls.find(
        (c) => c[0] === join(tmpDir, 'pyproject.toml') && c[1].toString().includes('[tool.mutmut]'),
      );
      expect(configWrite).toBeDefined();
      expect(configWrite![1].toString()).toContain('[tool.pytest]');
      expect(configWrite![1].toString()).toContain('[tool.mutmut]');
    });
  });

  describe('cleanup', () => {
    it('should restore backup after run completes', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      vi.mocked(spawn).mockReturnValue(
        mockChildProcess({ close: cb => { closeCb = cb; } }),
      );

      vi.mocked(existsSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml') && !p.endsWith('.xp-gate-backup')) {
          return true; // exists both initially and during cleanup
        }
        if (p.endsWith('.xp-gate-backup')) return true; // backup exists for cleanup
        return false;
      });

      const originalContent = '[tool.mutmut]\nsource_paths = ["original"]\n';
      vi.mocked(readFileSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('pyproject.toml.xp-gate-backup')) return originalContent;
        if (p.endsWith('pyproject.toml')) return originalContent;
        return '';
      });

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));
      await finish(closeCb, 0, promise);

      // Should have restored the backup
      expect(readFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml.xp-gate-backup'),
        'utf-8',
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml'),
        originalContent,
        { encoding: 'utf-8' },
      );
      expect(unlinkSync).toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml.xp-gate-backup'),
      );
    });

    it('should remove pyproject.toml when no backup existed', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = mockChildProcess({ close: cb => { closeCb = cb; } });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      let pyprojectExistsCallCount = 0;
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = path.toString();
        if (p.endsWith('.xp-gate-backup')) return false;
        if (p.endsWith('pyproject.toml')) {
          pyprojectExistsCallCount++;
          // Calls 1-2: run() + writeMutmutConfig() → false (no pre-existing file)
          // Call 3: cleanup finally block → true (code created it via mocked writeFileSync)
          return pyprojectExistsCallCount > 2;
        }
        return false;
      });

      const promise = new MutmutRunner().run(opts(['src/main.py'], 60000, tmpDir));
      await finish(closeCb, 0, promise);

      expect(unlinkSync).toHaveBeenCalledWith(join(tmpDir, 'pyproject.toml'));
      expect(readFileSync).not.toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml.xp-gate-backup'),
        expect.anything(),
      );
    });
  });

  describe('SIGKILL escalation guards', () => {
    it('escalates even though the pid is retained after reaping', async () => {
      // MEASURED: Node KEEPS `pid` after the child is reaped, so a `typeof pid ===
      // 'number'` check cannot detect recycling -- it only rules out a spawn that never
      // produced one. The guard is deliberately NOT that; this test records why, so the
      // check does not get "restored" by someone reading the field as a liveness probe.
      const child = mockChildProcess({});
      expect(typeof child.pid).toBe('number');
      (child as unknown as { signalCode: string | null }).signalCode = 'SIGTERM';
      const state = { settled: false, timeoutFired: true, stdout: '', stderr: '' };
      // The DEAD-PROCESS guard is what stops it: exitCode is still null for a
      // signal-killed child, so `signalCode` is the field that says it is gone.
      expect(shouldEscalate(state, child)).toBe(false);
    });

    it('does not signal a child that already exited', async () => {
      // `exitCode` is set the moment the process dies, possibly BEFORE `close` fires --
      // that gap is the window the escalation must not signal in.
      const child = mockChildProcess({});
      (child as unknown as { exitCode: number | null }).exitCode = 1;
      const state = { settled: false, timeoutFired: true, stdout: '', stderr: '' };
      expect(shouldEscalate(state, child)).toBe(false);
    });

    it('signals a child that is still running', async () => {
      const state = { settled: false, timeoutFired: true, stdout: '', stderr: '' };
      expect(shouldEscalate(state, mockChildProcess({}))).toBe(true);
    });
  });

  describe('preparation failures', () => {
    it('returns an outcome instead of rejecting when the config cannot be written', async () => {
      // A rejection here would reach the caller's `catch` and read as "no mutants found",
      // which is the fail-open this module exists to prevent. A tool that cannot prepare
      // the workspace is reported as `error`, like any other tool failure.
      const { writeFileSync } = await import('fs');
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('disk full');
      });
      vi.mocked(existsSync).mockReturnValue(false);
      mockChildProcess({});

      const outcome = await new MutmutRunner('linux').run(opts(['src/main.py'], 60000, tmpDir));

      expect(outcome.report).toBeNull();
      expect(outcome.error).toContain('disk full');
    });
  });

  describe('prepare-phase rollback', () => {
    it("restores the user's pyproject.toml when only the WRITE fails", async () => {
      // THE DATA-LOSS CASE: the backup succeeded, so a pyproject.toml was there and was
      // copied aside. The write then failed. Rolling back with a hardcoded `false` routes
      // to `removeCreated` and DELETES the user's own file -- so the rollback has to
      // consult what actually happened.
      const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);   // a pyproject.toml IS there
      vi.mocked(readFileSync).mockReturnValue('user content');
      const writes: string[] = [];
      vi.mocked(writeFileSync).mockImplementation((p) => {
        writes.push(String(p));
        if (String(p).endsWith('.xp-gate-backup')) return;   // the backup copy succeeds
        throw new Error('disk full');                        // the rewrite fails
      });
      mockChildProcess({});

      const outcome = await new MutmutRunner('linux').run(opts(['src/main.py'], 60000, tmpDir));

      expect(outcome.error).toContain('disk full');
      expect(writes).toContain(join(tmpDir, 'pyproject.toml'));
      expect(vi.mocked(unlinkSync)).not.toHaveBeenCalledWith(join(tmpDir, 'pyproject.toml'));
    });
  });

  describe('mutmutConfigContent', () => {
    it('replaces a MULTI-LINE source_paths instead of keeping the stale value', async () => {
      // TOML allows the array to span lines. Without the `s` flag `.*?` stops at the
      // first newline, so `replace` returns the input UNCHANGED -- the stale value is
      // kept and mutmut reads a source_paths that was never updated. (Measured.)
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      expect(typeof mutmutConfigContent).toBe('function');
      const existing = '[tool.mutmut]\nsource_paths = [\n  "old_a",\n  "old_b",\n]\n';
      const out = mutmutConfigContent(existing, 'source_paths = ["new"]');
      expect(out).not.toContain('old_a');
      expect(out).toContain('source_paths = ["new"]');
    });

    it('leaves an UNCLOSED array alone instead of adding a second key', async () => {
      // The file is already invalid. Appending `source_paths` again compounds it into two
      // keys in one table (measured). Returning the text unchanged leaves a single, still
      // broken key for the operator to see and fix.
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const broken = '[tool.mutmut]\nsource_paths = ["a"\n';
      expect(mutmutConfigContent(broken, 'source_paths = ["new"]')).toBe(broken);
    });

    it('handles a single-quoted string containing a bracket', async () => {
      // TOML allows single quotes; they are literal strings, so a `]` inside one is data.
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const out = mutmutConfigContent("[tool.mutmut]\nsource_paths = ['a]b', 'c']\n", 'source_paths = ["new"]');
      expect(out).toBe('[tool.mutmut]\nsource_paths = ["new"]\n');
    });

    it('rewrites the array when a path CONTAINS a bracket', async () => {
      // `["src]", "lib"]` is legal TOML. A lazy `[\s\S]*?\]` stops at the first `]` and
      // produced invalid output (measured). Brackets are balanced now.
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const out = mutmutConfigContent('[tool.mutmut]\nsource_paths = ["src]", "lib"]\n', 'source_paths = ["new"]');
      expect(out).toBe('[tool.mutmut]\nsource_paths = ["new"]\n');
    });

    it('rewrites the TABLE copy when the same body appears earlier', async () => {
      // Rebuilding the document by text made `replace` hit the FIRST occurrence, which
      // can belong to another table entirely (measured: `[tool.other]` got the new value
      // and `[tool.mutmut]` kept the old one). Indices remove the ambiguity.
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const out = mutmutConfigContent(
        '[tool.other]\nsource_paths = ["x"]\n\n[tool.mutmut]\nsource_paths = ["x"]\n',
        'source_paths = ["new"]',
      );
      expect(out).toContain('[tool.other]\nsource_paths = ["x"]');
      expect(out).toContain('[tool.mutmut]\nsource_paths = ["new"]');
    });

    it('ignores a COMMENTED-OUT [tool.mutmut] header', async () => {
      // `includes('[tool.mutmut]')` matched a comment, so the fallback inserted the key
      // into a commented-out header and left a DUPLICATE `source_paths` (measured). A
      // commented header means there is no table, so a real one is appended.
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const out = mutmutConfigContent('# [tool.mutmut]\nsource_paths = ["a"]\n', 'source_paths = ["new"]');
      expect(out.match(/^\[tool\.mutmut\]/gm)).toHaveLength(1);
    });

    it('leaves ANOTHER table\'s source_paths alone', async () => {
      // `source_paths` is a plausible key in any tool's table. An unscoped regex rewrote
      // `[tool.other]`'s value while leaving mutmut's untouched -- the exact inverse of
      // the intent (measured).
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const existing = '[tool.other]\nsource_paths = ["other_a"]\n\n[tool.mutmut]\nsource_paths = ["mut_a"]\n';
      const out = mutmutConfigContent(existing, 'source_paths = ["new"]');
      expect(out).toContain('source_paths = ["other_a"]');
      expect(out).not.toContain('mut_a');
    });

    it('replaces a single-line source_paths', async () => {
      const { mutmutConfigContent } = await import('../runners/mutmut-runner');
      const out = mutmutConfigContent('[tool.mutmut]\nsource_paths = ["old"]\n', 'source_paths = ["new"]');
      expect(out).not.toContain('"old"');
      expect(out).toContain('source_paths = ["new"]');
    });
  });
});
