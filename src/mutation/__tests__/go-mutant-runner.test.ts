/**
 * @test REQ-MUT-005 Go mutation runner
 * @intent Verify GoMutantRunner registration, availability checks, and JSON report parsing
 * @covers AC-MUT-005, AC-MUT-006
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

describe('GoMutantRunner', () => {
  let GoMutantRunner: typeof import('../runners/go-mutant-runner').GoMutantRunner;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `xp-gate-go-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    GoMutantRunner = (await import('../runners/go-mutant-runner')).GoMutantRunner;
  });

  afterEach(() => {
    try { process.kill(process.pid, 0); } catch { /* noop */ }
  });

  describe('name and extensions', () => {
    it('should have name "gomutants"', () => {
      const runner = new GoMutantRunner();
      expect(runner.name).toBe('gomutants');
    });

    it('should handle .go extension', () => {
      const runner = new GoMutantRunner();
      expect(runner.extensions).toContain('go');
      expect(runner.extensions).not.toContain('ts');
      expect(runner.extensions).not.toContain('py');
    });
  });

  describe('isAvailable', () => {
    it('should return true when gomutants is installed', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        output: [],
        pid: 0,
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>);

      const runner = new GoMutantRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith('gomutants', ['--version'], {
        stdio: 'pipe',
        timeout: 5000,
      });
    });

    it('should return false when gomutants is not installed', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        output: [],
        pid: 0,
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>);

      const runner = new GoMutantRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false when spawnSync throws', async () => {
      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const runner = new GoMutantRunner();
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('run', () => {
    it('should spawn gomutants with correct args', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      writeFileSync(join(tmpDir, '.gomutants-report.json'), JSON.stringify({
        test_efficacy: 80,
        mutants_total: 10,
        mutants_killed: 8,
        mutants_lived: 2,
        mutants_not_viable: 0,
        mutants_not_covered: 0,
      }));

      const runner = new GoMutantRunner();
      const promise = runner.run({
        files: ['src/main.go'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

      expect(spawn).toHaveBeenCalledWith('gomutants', [
        '--output',
        expect.stringContaining('.gomutants-report.json'),
        '--quiet',
      ], expect.objectContaining({ cwd: tmpDir }));

      expect(result.timedOut).toBe(false);
      expect(result.report!.mutationScore).toBe(80);
      expect(result.report!.nrOfMutants).toBe(10);
      expect(result.report!.nrOfKilledMutants).toBe(8);
      expect(result.report!.nrOfSurvivedMutants).toBe(2);
    });

    it('should return timedOut=true when killed', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(null), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new GoMutantRunner();
      const result = await runner.run({
        files: ['src/main.go'],
        timeoutMs: 100,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(true);
      expect(result.report).toBeNull();
    });

    it('should return error when spawn fails', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'error') setTimeout(() => cb(new Error('spawn ENOENT')), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new GoMutantRunner();
      const result = await runner.run({
        files: ['src/main.go'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe('spawn ENOENT');
    });

    it('should handle gomutants exit code 10 (below threshold) with report', async () => {
      let stderrCb: ((d: Buffer) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn((_event: string, cb: (d: Buffer) => void) => { stderrCb = cb; }) },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            setTimeout(() => {
              if (stderrCb) stderrCb(Buffer.from('below threshold'));
              cb(10);
            }, 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      writeFileSync(join(tmpDir, '.gomutants-report.json'), JSON.stringify({
        test_efficacy: 45,
        mutants_total: 50,
        mutants_killed: 22,
        mutants_lived: 18,
        mutants_not_covered: 10,
      }));

      const runner = new GoMutantRunner();
      const result = await runner.run({
        files: ['src/main.go'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.timedOut).toBe(false);
      expect(result.report).not.toBeNull();
      expect(result.report!.mutationScore).toBe(45);
      expect(result.error).toBeTruthy();
    });

    it('should return null report when report file does not exist', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const runner = new GoMutantRunner();
      const result = await runner.run({
        files: ['src/main.go'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      expect(result.report).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('should parse files array from report', async () => {
      let closeCb: ((code: number | null) => void) | null = null;
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') closeCb = cb;
        }),
        kill: vi.fn(),
        killed: false,
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      writeFileSync(join(tmpDir, '.gomutants-report.json'), JSON.stringify({
        test_efficacy: 80,
        mutants_total: 20,
        mutants_killed: 16,
        mutants_lived: 4,
        mutants_not_viable: 0,
        mutants_not_covered: 0,
        files: [
          {
            file_name: 'calculator.go',
            mutations: Array(12).fill({ status: 'KILLED' }).concat(Array(8).fill({ status: 'LIVED' })),
          },
        ],
      }));

      const runner = new GoMutantRunner();
      const promise = runner.run({
        files: ['src/calculator.go'],
        timeoutMs: 60000,
        cwd: tmpDir,
      });

      closeCb!(0);
      const result = await promise;

      expect(result.report).not.toBeNull();
      expect(result.report!.files).toBeDefined();
      expect(result.report!.files!['calculator.go'].mutationScore).toBe(60);
      expect(result.report!.files!['calculator.go'].nrOfMutants).toBe(20);
    });
  });
});
