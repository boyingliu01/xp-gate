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

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockReset();
    vi.mocked(spawn).mockReset();
    vi.mocked(execSync).mockReturnValue('mutmut, version 3.0.0\n');
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

      const runner = new MutmutRunner();
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
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') {
          throw new Error('command not found: mutmut');
        }
        return 'mutmut, version 3.0.0\n';
      });

      const runner = new MutmutRunner('win32');
      const result = await runner.isAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenNthCalledWith(2, 'wsl mutmut --version', {
        stdio: 'pipe',
        timeout: 5000,
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
      const outcome = await runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(outcome).toEqual({ report: null, timedOut: false });
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('should spawn mutmut run and parse emoji progress', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = {
        stdout: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stdoutCb = cb;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      // No existing pyproject.toml
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      // Simulate stdout with emoji progress
      const progressOutput =
        '38/38  🎉 9 🫥 29  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0\n';
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

    it('should execute native mutmut when native detection succeeds on Windows', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') return 'mutmut, version 3.0.0\n';
        throw new Error('WSL unavailable');
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: 'C:\\work\\project',
      });
      closeCb!(0);
      await promise;

      expect(execSync).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        'mutmut',
        ['run'],
        expect.objectContaining({ cwd: 'C:\\work\\project' }),
      );
    });

    it('should execute selected WSL route with Linux --cd and Windows host cwd', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') {
          throw new Error('native mutmut unavailable');
        }
        return 'mutmut, version 3.0.0\n';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: 'C:\\work\\project',
      });
      closeCb!(0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/c/work/project', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'C:\\work\\project' }),
      );
      expect(vi.mocked(spawn).mock.calls[0]?.[2]).not.toHaveProperty('shell');
    });

    it('should preserve spaced and metacharacter paths as one WSL argv item', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'mutmut, version 3.0.0\n';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: 'C:\\work dir\\safe; echo injected',
      });
      closeCb!(0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/c/work dir/safe; echo injected', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'C:\\work dir\\safe; echo injected' }),
      );
      expect(vi.mocked(spawn).mock.calls[0]?.[2]).not.toHaveProperty('shell');
    });

    it.each([
      ['uppercase drive', 'C:\\Work\\Project', '/mnt/c/Work/Project'],
      ['forward slash drive', 'D:/Work/Project', '/mnt/d/Work/Project'],
    ])('should convert %s paths for WSL', async (_name, windowsPath, linuxPath) => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'mutmut, version 3.0.0\n';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: windowsPath });
      closeCb!(0);
      await promise;

      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['--cd', linuxPath, 'mutmut', 'run']);
    });

    it.each(['relative/project', '\\\\server\\share\\project'])(
      'should fail closed for non-drive WSL path %s', async (cwd) => {
        vi.mocked(execSync).mockImplementation((command) => {
          if (command === 'mutmut --version') throw new Error('native unavailable');
          return 'mutmut, version 3.0.0\n';
        });
        vi.mocked(existsSync).mockReturnValue(false);

        const runner = new MutmutRunner('win32');
        expect(await runner.isAvailable()).toBe(true);
        const outcome = await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd });

        expect(outcome).toEqual({ report: null, timedOut: false });
        expect(spawn).not.toHaveBeenCalled();
      },
    );

    it('should follow repeated native to WSL availability transitions', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      let nativeAvailable = true;
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version' && nativeAvailable) return 'native';
        if (command === 'wsl mutmut --version') return 'wsl';
        throw new Error('unavailable');
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      nativeAvailable = false;
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });
      closeCb!(0);
      await promise;

        expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('wsl');
    });

    it('should follow repeated WSL to native availability transitions', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') cb(0);
        }),
        kill: vi.fn(),
        killed: false,
      };
      let nativeAvailable = false;
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version' && nativeAvailable) return 'native';
        if (command === 'wsl mutmut --version') return 'wsl';
        throw new Error('unavailable');
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      nativeAvailable = true;
      expect(await runner.isAvailable()).toBe(true);
      await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });

      expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('mutmut');
    });

    it('should stop spawning after availability transitions to unavailable', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('unavailable');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(false);
      const outcome = await runner.run({ files: ['src/main.py'], timeoutMs: 60000, cwd: 'C:\\repo' });

      expect(outcome).toEqual({ report: null, timedOut: false });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should clear timers when the child closes before timeout', async () => {
      vi.useFakeTimers();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') cb(0);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await new MutmutRunner('linux').run({
        files: ['src/main.py'],
        timeoutMs: 100,
        cwd: tmpDir,
      });
      await vi.advanceTimersByTimeAsync(5100);

      expect(result.timedOut).toBe(false);
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should clear timers when the child emits an error', async () => {
      vi.useFakeTimers();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (error: Error) => void) => {
          if (event === 'error') cb(new Error('spawn failed'));
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await new MutmutRunner('linux').run({
        files: ['src/main.py'],
        timeoutMs: 100,
        cwd: tmpDir,
      });
      await vi.advanceTimersByTimeAsync(5100);

      expect(result.error).toBe('spawn failed');
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should report timeout when the timed-out process closes with a code', async () => {
      vi.useFakeTimers();
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'wsl';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({ files: ['src/main.py'], timeoutMs: 100, cwd: 'C:\\repo' });
      await vi.advanceTimersByTimeAsync(100);
      closeCb!(1);
      const outcome = await promise;

      expect(outcome.timedOut).toBe(true);
    });

    it('should escalate to SIGKILL when SIGTERM does not close the child', async () => {
      vi.useFakeTimers();
      let closeCb: ((code: number | null) => void) | null = null;
      let killCount = 0;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(() => {
          killCount += 1;
          if (killCount === 2) closeCb?.(null);
          return true;
        }),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'wsl';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
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
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(() => {
          closeCb?.(null);
          return true;
        }),
        killed: false,
      };
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === 'mutmut --version') throw new Error('native unavailable');
        return 'mutmut, version 3.0.0\n';
      });
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner('win32');
      expect(await runner.isAvailable()).toBe(true);
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 100,
        cwd: 'D:\\repo',
      });
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'wsl',
        ['--cd', '/mnt/d/repo', 'mutmut', 'run'],
        expect.objectContaining({ cwd: 'D:\\repo' }),
      );
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toEqual({ report: null, timedOut: true });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should return timedOut=false when process closes before timeout (code=null)', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') setTimeout(() => cb(null), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const result = await runner.run({
        files: ['src/main.py'],
        timeoutMs: 100,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(false);
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
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const result = await runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('spawn mutmut ENOENT');
    });

    it('should return error message when exit code is non-zero', async () => {
      let stderrCb: ((d: Buffer) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stderrCb = cb;
          }),
        },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') {
            setTimeout(() => {
              if (stderrCb) stderrCb(Buffer.from('mutation failed'));
              cb(1);
            }, 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const result = await runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('mutation failed');
    });
  });

  describe('emoji progress parsing', () => {
    it('should parse standard progress line with all emojis', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = {
        stdout: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stdoutCb = cb;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/calc.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      const output = '20/20  🎉 10 🫥 5  ⏰ 2  🤔 1  🙁 2  🔇 0  🧙 0\n';
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

      const mockChild = {
        stdout: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stdoutCb = cb;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      stdoutCb!(Buffer.from('Some random output without emoji\n'));
      closeCb!(0);

      const result = await promise;
      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should return null report when all mutant counts are zero', async () => {
      let stdoutCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const mockChild = {
        stdout: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stdoutCb = cb;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      const output = '0/0  🎉 0 🫥 0  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0\n';
      stdoutCb!(Buffer.from(output));
      closeCb!(0);

      const result = await promise;
      expect(result.report).toBeNull();
    });
  });

  describe('pyproject.toml config writing', () => {
    it('should create new pyproject.toml when file does not exist', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
      vi.mocked(existsSync).mockReturnValue(false);

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py', 'src/utils.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });
      closeCb!(0);
      await promise;

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
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
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

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });
      closeCb!(0);
      await promise;

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
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
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

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });
      closeCb!(0);
      await promise;

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
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

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

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });
      closeCb!(0);
      await promise;

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
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
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

      const runner = new MutmutRunner();
      const promise = runner.run({
        files: ['src/main.py'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });
      closeCb!(0);
      await promise;

      expect(unlinkSync).toHaveBeenCalledWith(join(tmpDir, 'pyproject.toml'));
      expect(readFileSync).not.toHaveBeenCalledWith(
        join(tmpDir, 'pyproject.toml.xp-gate-backup'),
        expect.anything(),
      );
    });
  });
});
