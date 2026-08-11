/**
 * @test update-baseline.ts - Mutation baseline update CLI
 * @intent Verify parseArgs, updateBaseline, removeDeletedFiles, and readBaseline
 *         work correctly through the module's side effects
 * @covers REQ-MUT-001 AC-004 (baseline update from mutation scores)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn()
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn()
}));

const mockFs = await import('fs/promises');

interface MockBaseline {
  version: string;
  generatedAt: string;
  source: 'local' | 'ci';
  scores: Record<string, { score: number; mutants: number; killed: number; survived: number }>;
}

function makeBaseline(overrides: Partial<MockBaseline> = {}): MockBaseline {
  return {
    version: '1.0.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    source: 'local',
    scores: {},
    ...overrides
  };
}

describe('update-baseline.ts - Mutation Baseline Update CLI', () => {
  let originalArgv: string[];
  let originalExit: typeof process.exit;
  let originalCwd: typeof process.cwd;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    originalCwd = process.cwd;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    process.exit = ((code?: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;

    process.cwd = () => '/fake/project';

    vi.resetModules();
    vi.clearAllMocks();
    exitCode = undefined;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    process.cwd = originalCwd;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  async function importModule(): Promise<void> {
    await import('../update-baseline');
    // Allow the main() promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  describe('parseArgs', () => {
    it('should parse valid --scores argument with single file', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:75.5'];
      const baseline = makeBaseline();
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      expect(exitCode).toBeUndefined();
      expect(mockFs.default.writeFile).toHaveBeenCalled();
      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(written.scores['src/foo.ts'].score).toBe(75.5);
    });

    it('should parse multiple comma-separated scores', async () => {
      process.argv = [
        'node',
        'update-baseline.js',
        '--scores',
        'src/a.ts:80.0,src/b.ts:65.3,src/c.ts:92.7'
      ];
      const baseline = makeBaseline();
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(Object.keys(written.scores)).toHaveLength(3);
      expect(written.scores['src/a.ts'].score).toBe(80.0);
      expect(written.scores['src/b.ts'].score).toBe(65.3);
      expect(written.scores['src/c.ts'].score).toBe(92.7);
    });

    it('should throw and exit 1 when --scores is missing', async () => {
      process.argv = ['node', 'update-baseline.js'];

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Missing required argument: --scores')
      );
    });

    it('should throw and exit 1 when score format is invalid (missing colon)', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts'];

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid score format')
      );
    });

    it('should throw and exit 1 when score value is NaN', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:notanumber'];

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid score value')
      );
    });

    it('should throw and exit 1 when score is out of range (>100)', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:150'];

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid score value')
      );
    });

    it('should throw and exit 1 when score is negative', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:-5'];

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid score value')
      );
    });
  });

  describe('updateBaseline (via module side effects)', () => {
    it('should merge new scores into existing baseline entries', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/existing.ts:88.5'];
      const baseline = makeBaseline({
        scores: {
          'src/existing.ts': { score: 50.0, mutants: 10, killed: 5, survived: 5 }
        }
      });
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      // Score should be updated
      expect(written.scores['src/existing.ts'].score).toBe(88.5);
      // Existing metadata should be preserved
      expect(written.scores['src/existing.ts'].mutants).toBe(10);
      expect(written.scores['src/existing.ts'].killed).toBe(5);
      expect(written.scores['src/existing.ts'].survived).toBe(5);
    });

    it('should add new file entries with zeroed metadata', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/new.ts:72.0'];
      const baseline = makeBaseline({
        scores: {
          'src/old.ts': { score: 60.0, mutants: 8, killed: 4, survived: 4 }
        }
      });
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(written.scores['src/new.ts']).toEqual({
        score: 72.0,
        mutants: 0,
        killed: 0,
        survived: 0
      });
      // Old entry should still be present
      expect(written.scores['src/old.ts'].score).toBe(60.0);
    });

    it('should update generatedAt timestamp', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:50.0'];
      const baseline = makeBaseline({ generatedAt: '2020-01-01T00:00:00.000Z' });
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(written.generatedAt).not.toBe('2020-01-01T00:00:00.000Z');
      // Should be a valid ISO date string
      expect(new Date(written.generatedAt).toISOString()).toBe(written.generatedAt);
    });

    it('should round score to 1 decimal place', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:66.66666'];
      const baseline = makeBaseline();
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(written.scores['src/foo.ts'].score).toBe(66.7);
    });
  });

  describe('removeDeletedFiles (via module side effects)', () => {
    it('should remove files that no longer exist on disk', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/keep.ts:80.0'];
      const baseline = makeBaseline({
        scores: {
          'src/keep.ts': { score: 70.0, mutants: 10, killed: 7, survived: 3 },
          'src/deleted.ts': { score: 50.0, mutants: 5, killed: 2, survived: 3 }
        }
      });
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockImplementation(
        (filePath: string) => {
          if (filePath.includes('deleted.ts')) {
            return Promise.reject(new Error('ENOENT'));
          }
          return Promise.resolve(undefined);
        }
      );
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(written.scores['src/keep.ts']).toBeDefined();
      expect(written.scores['src/deleted.ts']).toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Removing deleted file from baseline: src/deleted.ts')
      );
    });

    it('should keep all files when they all exist on disk', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/a.ts:90.0'];
      const baseline = makeBaseline({
        scores: {
          'src/a.ts': { score: 80.0, mutants: 10, killed: 8, survived: 2 },
          'src/b.ts': { score: 70.0, mutants: 8, killed: 5, survived: 3 }
        }
      });
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const written = JSON.parse(
        (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      );
      expect(Object.keys(written.scores)).toHaveLength(2);
    });
  });

  describe('readBaseline (via module side effects)', () => {
    it('should fail with error when baseline file does not exist', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:50.0'];
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ENOENT: no such file')
      );

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read baseline file')
      );
    });

    it('should fail with error when baseline file contains invalid JSON', async () => {
      process.argv = ['node', 'update-baseline.js', '--scores', 'src/foo.ts:50.0'];
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        'not-valid-json{{{'
      );

      await importModule();

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read baseline file')
      );
    });
  });

  describe('end-to-end output', () => {
    it('should log per-file scores and total file count', async () => {
      process.argv = [
        'node',
        'update-baseline.js',
        '--scores',
        'src/a.ts:80.0,src/b.ts:60.0'
      ];
      const baseline = makeBaseline();
      (mockFs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(baseline)
      );
      (mockFs.default.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockFs.default.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await importModule();

      const allLogs = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(allLogs).toEqual(
        expect.arrayContaining([
          'Reading existing mutation baseline...',
          'Updating 2 file score(s)...',
          'Checking for deleted files...',
          'Total files: 2'
        ])
      );
      expect(allLogs).toEqual(expect.arrayContaining(['  src/a.ts: 80%', '  src/b.ts: 60%']));
    });
  });
});
