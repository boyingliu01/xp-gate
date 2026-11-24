/**
 * @test REQ-MUT-004 Stryker mutation runner
 * @intent Verify StrykerRunner registration, availability checks, Stryker report parsing,
 *         timeout handling, spawn errors, and per-file breakdown
 * @covers AC-MUT-004, AC-MUT-006
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});


/**
 * A child-process double whose 'close' the test fires explicitly.
 *
 * Ten tests built this object inline. The shared spawn helper registers its
 * listeners inside a Promise, so a test must let the microtask queue drain
 * before firing it -- see `untilClose`.
 */
function makeChildDouble(): {
  child: ChildProcess;
  fireClose: (code: number | null) => void;
} {
  let closeCb: ((code: number | null) => void) | null = null;
  const child = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') closeCb = cb;
    }),
    kill: vi.fn(),
    killed: false,
  };
  return {
    child: child as unknown as ChildProcess,
    fireClose: (code) => closeCb!(code),
  };
}

/** Let the shared spawn helper install its listeners before a test fires them. */
async function untilClose(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}


/** Write the Stryker config and a report with the given score breakdown. */
function writeStrykerFixtures(
  dir: string,
  report: { score: number; mutants: number; killed: number; survived: number } | null,
): void {
  writeFileSync(join(dir, 'stryker.prepush.conf.json'), '{}');
  if (!report) return;
  writeFileSync(join(dir, '.stryker-report.json'), JSON.stringify({
    mutationScore: report.score,
    nrOfMutants: report.mutants,
    nrOfKilledMutants: report.killed,
    nrOfSurvivedMutants: report.survived,
  }));
}

describe('StrykerRunner', () => {
  let StrykerRunner: typeof import('../runners/stryker-runner').StrykerRunner;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `xp-gate-stryker-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    StrykerRunner = (await import('../runners/stryker-runner')).StrykerRunner;
  });

  // ── name and extensions ──────────────────────────────────────────────────────

  describe('name and extensions', () => {
    it('should have name "Stryker"', () => {
      const runner = new StrykerRunner();
      expect(runner.name).toBe('Stryker');
    });

    it('should handle .ts and .tsx extensions', () => {
      const runner = new StrykerRunner();
      expect(runner.extensions).toContain('ts');
      expect(runner.extensions).toContain('tsx');
      expect(runner.extensions).not.toContain('go');
      expect(runner.extensions).not.toContain('py');
    });
  });

  // ── isAvailable ──────────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('should return true when npx stryker is available (exit 0)', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        output: [],
        pid: 0,
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>);

      const runner = new StrykerRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith(
        'npx',
        ['stryker', '--version'],
        expect.objectContaining({ stdio: 'pipe', timeout: 5000 }),
      );
    });

    it('should return false when npx stryker is not installed (non-zero exit)', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        output: [],
        pid: 0,
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>);

      const runner = new StrykerRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false when spawnSync throws', async () => {
      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const runner = new StrykerRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });
  });

  // ── run ──────────────────────────────────────────────────────────────────────

  describe('run', () => {
    it('should spawn npx stryker run with correct args and parse valid report', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      writeStrykerFixtures(tmpDir, { score: 75, mutants: 40, killed: 30, survived: 10 });

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts', 'src/b.tsx'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      await untilClose();
      fireClose!(0);
      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        [
          'stryker', 'run',
          '--config', join(tmpDir, 'stryker.prepush.conf.json'),
          '--mutate', 'src/a.ts',
          '--mutate', 'src/b.tsx',
        ],
        // stdin is explicitly ignored: a mutation tool that decides to prompt
        // would otherwise block until the gate times out.
        expect.objectContaining({
          cwd: tmpDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        }),
      );

      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(75);
      expect(result.report!.nrOfMutants).toBe(40);
      expect(result.report!.nrOfKilledMutants).toBe(30);
      expect(result.report!.nrOfSurvivedMutants).toBe(10);
      expect(result.error).toBeUndefined();
    });

    it('should omit --config when stryker.prepush.conf.json does not exist', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      fireClose!(0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['stryker', 'run', '--mutate', 'src/a.ts'],
        expect.objectContaining({ cwd: tmpDir }),
      );
    });

    it('should return timedOut=true when child is killed (close code null)', async () => {
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

      const runner = new StrykerRunner();
      const result = await runner.run({
        files: ['src/a.ts'],
        timeoutMs: 100,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(true);
      expect(result.report).toBeNull();
    });

    it('should return error when spawn fails (error event)', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('spawn ENOENT')), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new StrykerRunner();
      const result = await runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('spawn ENOENT');
    });

    it('should include stderr as error on non-zero exit code', async () => {
      let stderrCb: ((d: Buffer) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((_event: string, cb: (d: Buffer) => void) => {
            stderrCb = cb;
          }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => {
              if (stderrCb) stderrCb(Buffer.from('mutation score below threshold'));
              cb(1);
            }, 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      writeFileSync(join(tmpDir, '.stryker-report.json'), JSON.stringify({
        mutationScore: 40,
        nrOfMutants: 50,
        nrOfKilledMutants: 20,
        nrOfSurvivedMutants: 30,
      }));

      const runner = new StrykerRunner();
      const result = await runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(40);
      expect(result.error).toContain('mutation score below threshold');
    });

    it('should return null report when .stryker-report.json does not exist', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new StrykerRunner();
      const result = await runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });
  });

  // ── Report parsing ────────────────────────────────────────────────────────────

  describe('report parsing', () => {
    it('should parse valid Stryker JSON report', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      writeFileSync(join(tmpDir, '.stryker-report.json'), JSON.stringify({
        mutationScore: 88.5,
        nrOfMutants: 100,
        nrOfKilledMutants: 88,
        nrOfSurvivedMutants: 12,
      }));

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      await untilClose();
      fireClose!(0);
      const result = await promise;

      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(88.5);
      expect(result.report!.nrOfMutants).toBe(100);
      expect(result.report!.nrOfKilledMutants).toBe(88);
      expect(result.report!.nrOfSurvivedMutants).toBe(12);
    });

    it('should return null report for invalid JSON', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      writeFileSync(join(tmpDir, '.stryker-report.json'), 'not valid json {{{');

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      await untilClose();
      fireClose!(0);
      const result = await promise;

      expect(result.report).toBeNull();
    });

    it('should default missing numeric fields to 0 (asNumber fallback)', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      writeFileSync(join(tmpDir, '.stryker-report.json'), JSON.stringify({
        someOtherField: 'value',
      }));

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      await untilClose();
      fireClose!(0);
      const result = await promise;

      // asNumber defaults non-number values to 0; isNaN(0) is false → report is non-null
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(0);
      expect(result.report!.nrOfMutants).toBe(0);
      expect(result.report!.nrOfKilledMutants).toBe(0);
      expect(result.report!.nrOfSurvivedMutants).toBe(0);
    });

    it('should parse per-file breakdown from files object', async () => {
      const { child: mockChild, fireClose } = makeChildDouble();
      vi.mocked(spawn).mockReturnValue(mockChild);

      writeFileSync(join(tmpDir, '.stryker-report.json'), JSON.stringify({
        mutationScore: 70,
        nrOfMutants: 30,
        nrOfKilledMutants: 21,
        nrOfSurvivedMutants: 9,
        files: {
          'src/a.ts': {
            mutationScore: 80,
            nrOfMutants: 10,
            nrOfKilledMutants: 8,
            nrOfSurvivedMutants: 2,
          },
          'src/b.tsx': {
            mutationScore: 60,
            nrOfMutants: 20,
            nrOfKilledMutants: 12,
            nrOfSurvivedMutants: 8,
          },
        },
      }));

      const runner = new StrykerRunner();
      const promise = runner.run({
        files: ['src/a.ts', 'src/b.tsx'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      await untilClose();
      fireClose!(0);
      const result = await promise;

      expect(result.report).not.toBeNull();
      expect(result.report!.files).toBeDefined();
      expect(result.report!.files!['src/a.ts'].mutationScore).toBe(80);
      expect(result.report!.files!['src/a.ts'].nrOfMutants).toBe(10);
      expect(result.report!.files!['src/a.ts'].nrOfKilledMutants).toBe(8);
      expect(result.report!.files!['src/a.ts'].nrOfSurvivedMutants).toBe(2);
      expect(result.report!.files!['src/b.tsx'].mutationScore).toBe(60);
      expect(result.report!.files!['src/b.tsx'].nrOfMutants).toBe(20);
    });
  });
});
