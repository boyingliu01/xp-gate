/**
 * @intent #410: mutmut 3.x depends on fork() and cannot run natively on
 *         Windows — Gate M (Python) formed a structural deadlock (installed =>
 *         always blocked, uninstalled => always skipped). pytest-gremlins is
 *         architecturally cross-platform (mutation switching, no fork), so it
 *         becomes the second engine. This runner drives
 *         `pytest --gremlins` and parses the console report.
 * @covers GremlinsRunner availability probe + console report parsing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

/** Capture the stdout/close callbacks so the test can drive them by hand. */
function mockChild(capture: {
  stdout?: (cb: (d: Buffer) => void) => void;
  stderr?: (cb: (d: Buffer) => void) => void;
  close?: (cb: (code: number | null) => void) => void;
  error?: (cb: (e: Error) => void) => void;
}): ChildProcess {
  return {
    stdout: { on: (_e: string, cb: (d: Buffer) => void) => capture.stdout?.(cb) },
    stderr: { on: (_e: string, cb: (d: Buffer) => void) => capture.stderr?.(cb) },
    on: (event: string, cb: (arg: never) => void) => {
      if (event === 'close') capture.close?.(cb as (code: number | null) => void);
      if (event === 'error') capture.error?.(cb as unknown as (e: Error) => void);
    },
    kill: vi.fn(),
  } as unknown as ChildProcess;
}

describe('GremlinsRunner', () => {
  let GremlinsRunner: typeof import('../runners/gremlins-runner').GremlinsRunner;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockReset();
    vi.mocked(spawn).mockReset();
    vi.mocked(execSync).mockReturnValue('' as never);
    GremlinsRunner = (await import('../runners/gremlins-runner')).GremlinsRunner;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declares the pytest-gremlins engine name and the py extension', () => {
    const runner = new GremlinsRunner();
    expect(runner.name).toBe('pytest-gremlins');
    expect(runner.extensions).toEqual(['py']);
  });

  it('isAvailable probes the pytest_gremlins import', async () => {
    const runner = new GremlinsRunner();
    await expect(runner.isAvailable()).resolves.toBe(true);
    const probed = vi.mocked(execSync).mock.calls[0]?.[0] as string;
    expect(probed).toContain('import pytest_gremlins');
  });

  it('isAvailable returns false when the import probe fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('ModuleNotFoundError');
    });
    const runner = new GremlinsRunner();
    await expect(runner.isAvailable()).resolves.toBe(false);
  });

  it('parses the console report (Zapped/Survived) into a normalized result', async () => {
    let closeCb: ((code: number | null) => void) | undefined;
    let stdoutCb: ((d: Buffer) => void) | undefined;
    vi.mocked(spawn).mockReturnValue(
      mockChild({
        stdout: cb => { stdoutCb = cb; },
        close: cb => { closeCb = cb; },
      }),
    );

    const runner = new GremlinsRunner();
    const promise = runner.run({ files: ['src/foo.py'], timeoutMs: 5000, cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 0));

    stdoutCb?.(
      Buffer.from(
        '================== pytest-gremlins mutation report ==================\n' +
          'Zapped: 142 gremlins (89%)\n' +
          'Survived: 18 gremlins (11%)\n' +
          '=====================================================================\n',
      ),
    );
    closeCb?.(0);

    const outcome = await promise;
    expect(outcome.report).not.toBeNull();
    expect(outcome.report?.nrOfKilledMutants).toBe(142);
    expect(outcome.report?.nrOfSurvivedMutants).toBe(18);
    expect(outcome.report?.nrOfMutants).toBe(160);
    expect(Math.round(outcome.report!.mutationScore)).toBe(89);
    expect(outcome.timedOut).toBe(false);
  });

  it('returns report=null (never throws) when the report lines are absent', async () => {
    let closeCb: ((code: number | null) => void) | undefined;
    vi.mocked(spawn).mockReturnValue(mockChild({ stdout: () => { /* no output: the stub emits nothing on stdout */ }, close: cb => { closeCb = cb; } }));

    const runner = new GremlinsRunner();
    const promise = runner.run({ files: ['src/foo.py'], timeoutMs: 5000, cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 0));
    closeCb?.(1);

    const outcome = await promise;
    expect(outcome.report).toBeNull();
  });

  it('returns report=null when the report has zero gremlins', async () => {
    let closeCb: ((code: number | null) => void) | undefined;
    let stdoutCb: ((d: Buffer) => void) | undefined;
    vi.mocked(spawn).mockReturnValue(
      mockChild({ stdout: cb => { stdoutCb = cb; }, close: cb => { closeCb = cb; } }),
    );

    const runner = new GremlinsRunner();
    const promise = runner.run({ files: ['src/foo.py'], timeoutMs: 5000, cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 0));
    stdoutCb?.(Buffer.from('Zapped: 0 gremlins (0%)\nSurvived: 0 gremlins (0%)\n'));
    closeCb?.(0);

    const outcome = await promise;
    expect(outcome.report).toBeNull();
  });

  it('passes --gremlin-targets derived from the changed file directories', async () => {
    let closeCb: ((code: number | null) => void) | undefined;
    vi.mocked(spawn).mockReturnValue(mockChild({ stdout: () => { /* no output: the stub emits nothing on stdout */ }, close: cb => { closeCb = cb; } }));

    const runner = new GremlinsRunner();
    const promise = runner.run({ files: ['src/foo/bar.py', 'src/baz.py'], timeoutMs: 5000, cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 0));
    closeCb?.(0);
    await promise;

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const joined = spawnArgs.join(' ');
    expect(joined).toContain('--gremlins');
    expect(joined).toContain('--gremlin-targets=src/foo,src');
  });

  it('reports timedOut when the child exceeds the deadline', async () => {
    let closeCb: ((code: number | null) => void) | undefined;
    const child = mockChild({ stdout: () => { /* no output: the stub emits nothing on stdout */ }, close: cb => { closeCb = cb; } });
    vi.mocked(spawn).mockReturnValue(child);

    const runner = new GremlinsRunner();
    const promise = runner.run({ files: ['src/foo.py'], timeoutMs: 1, cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 20));
    closeCb?.(null);

    const outcome = await promise;
    expect(outcome.timedOut).toBe(true);
    expect(child.kill).toHaveBeenCalled();
  });
});
