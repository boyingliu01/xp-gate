/**
 * @test REQ-COV-003 BaselineStorage uncovered branches
 * @intent Cover initializeWithAnalyzer (batching, timeout, errors) and ccn statistics
 * @covers AC-COV-003
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { BaselineStorage } from '../baseline';

describe('BaselineStorage - extended coverage', () => {
  let tmpDir: string;
  let baselinePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-test-'));
    baselinePath = path.join(tmpDir, '.warnings-baseline.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('getSummaryStatistics - ccn aggregation', () => {
    it('aggregates ccn warnings and max across files', () => {
      const storage = new BaselineStorage();
      const baseline = {
        'src/a.ts': {
          ccn: { warnings: 3, max: 12 },
          totalWarnings: 3,
          lastAnalyzed: new Date().toISOString(),
        },
        'src/b.ts': {
          ccn: { warnings: 5, max: 18 },
          totalWarnings: 5,
          lastAnalyzed: new Date().toISOString(),
        },
      };

      const stats = storage.getSummaryStatistics(baseline);

      expect(stats.totalFiles).toBe(2);
      expect(stats.ccn?.totalWarnings).toBe(8);
      expect(stats.ccn?.totalMax).toBe(30);
    });

    it('returns averageWarningsPerFile of 0 for empty baseline', () => {
      const storage = new BaselineStorage();
      const stats = storage.getSummaryStatistics({});

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalWarnings).toBe(0);
      expect(stats.averageWarningsPerFile).toBe(0);
      expect(stats.ccn).toBeUndefined();
    });
  });

  describe('initializeWithAnalyzer - batching and progress', () => {
    it('processes files in batches based on batchSize config', async () => {
      const storage = new BaselineStorage({ batchSize: 2 });
      const files = ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts'];
      const callOrder: string[] = [];

      const warningFn = vi.fn(async (file: string) => {
        callOrder.push(file);
        return { eslint: { warnings: 1, errors: 0 } };
      });

      const result = await storage.initializeWithAnalyzer(files, warningFn);

      expect(warningFn).toHaveBeenCalledTimes(5);
      expect(Object.keys(result)).toHaveLength(5);
      expect(callOrder).toEqual(files);
    });

    it('invokes onProgress callback for each completed file', async () => {
      const storage = new BaselineStorage({ batchSize: 2 });
      const files = ['a.ts', 'b.ts', 'c.ts'];
      const progressEvents: Array<{ current: number; total: number }> = [];

      await storage.initializeWithAnalyzer(
        files,
        async () => ({ eslint: { warnings: 1, errors: 0 } }),
        (progress) => {
          progressEvents.push({ current: progress.current, total: progress.total });
        },
      );

      expect(progressEvents).toHaveLength(3);
      expect(progressEvents[progressEvents.length - 1].current).toBe(3);
      expect(progressEvents.every((e) => e.total === 3)).toBe(true);
    });
  });

  describe('initializeWithAnalyzer - error and limit handling', () => {
    it('throws when files array exceeds maxSize', async () => {
      const storage = new BaselineStorage({ maxSize: 2 });
      const files = ['a.ts', 'b.ts', 'c.ts'];

      await expect(
        storage.initializeWithAnalyzer(files, async () => ({})),
      ).rejects.toThrow(/exceeds the maximum of 2/);
    });

    it('logs errors via console.error when warningCountFunction rejects', async () => {
      const storage = new BaselineStorage({ batchSize: 5 });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const files = ['ok.ts', 'fail.ts'];

      const warningFn = async (file: string) => {
        if (file === 'fail.ts') {
          throw new Error('analyzer crashed');
        }
        return { eslint: { warnings: 2, errors: 0 } };
      };

      const result = await storage.initializeWithAnalyzer(files, warningFn);

      expect(errorSpy).toHaveBeenCalledWith(
        'Some files failed to analyze:',
        expect.any(Array),
      );
      expect(result['ok.ts']).toBeDefined();
      expect(result['fail.ts']).toBeUndefined();
    });

    it('rejects with timeout when processing exceeds timeoutMs', async () => {
      const storage = new BaselineStorage({ timeoutMs: 50, batchSize: 1 });
      const files = ['slow.ts'];

      const warningFn = () =>
        new Promise<{ totalWarnings: number }>((resolve) => {
          setTimeout(() => resolve({ totalWarnings: 1 }), 200);
        });

      await expect(
        storage.initializeWithAnalyzer(files, warningFn),
      ).rejects.toThrow(/timed out/);
    });
  });

  describe('initializeWithAnalyzer - totalWarnings calculation', () => {
    it('calculates totalWarnings from eslint-only entries', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['a.ts'], async () => ({
        eslint: { warnings: 7, errors: 1 },
      }));

      expect(result['a.ts'].totalWarnings).toBe(7);
      expect(result['a.ts'].eslint).toEqual({ warnings: 7, errors: 1 });
    });

    it('calculates totalWarnings from principles-only entries', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['b.ts'], async () => ({
        principles: { warnings: 4, errors: 0 },
      }));

      expect(result['b.ts'].totalWarnings).toBe(4);
      expect(result['b.ts'].principles).toEqual({ warnings: 4, errors: 0 });
    });

    it('calculates totalWarnings from ccn-only entries', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['c.ts'], async () => ({
        ccn: { warnings: 6, max: 15 },
      }));

      expect(result['c.ts'].totalWarnings).toBe(6);
      expect(result['c.ts'].ccn).toEqual({ warnings: 6, max: 15 });
    });

    it('uses explicit totalWarnings override when provided', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['d.ts'], async () => ({
        eslint: { warnings: 3, errors: 0 },
        principles: { warnings: 2, errors: 0 },
        ccn: { warnings: 1, max: 5 },
        totalWarnings: 99,
      }));

      expect(result['d.ts'].totalWarnings).toBe(99);
    });

    it('aggregates totalWarnings across all three sources when no override', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['e.ts'], async () => ({
        eslint: { warnings: 2, errors: 0 },
        principles: { warnings: 3, errors: 0 },
        ccn: { warnings: 4, max: 10 },
      }));

      expect(result['e.ts'].totalWarnings).toBe(9);
    });

    it('sets totalWarnings to 0 when warningCountFunction returns empty object', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['empty.ts'], async () => ({}));

      expect(result['empty.ts'].totalWarnings).toBe(0);
      expect(result['empty.ts'].eslint).toBeUndefined();
      expect(result['empty.ts'].principles).toBeUndefined();
      expect(result['empty.ts'].ccn).toBeUndefined();
    });

    it('honors explicit totalWarnings of 0 when provided', async () => {
      const storage = new BaselineStorage();
      const result = await storage.initializeWithAnalyzer(['z.ts'], async () => ({
        eslint: { warnings: 5, errors: 0 },
        totalWarnings: 0,
      }));

      expect(result['z.ts'].totalWarnings).toBe(0);
    });
  });

  describe('initializeWithAnalyzer - integration with save/load', () => {
    it('saves and reloads baseline produced by initializeWithAnalyzer', async () => {
      const storage = new BaselineStorage();
      const built = await storage.initializeWithAnalyzer(
        ['file1.ts', 'file2.ts'],
        async (file) => ({
          eslint: { warnings: file === 'file1.ts' ? 1 : 2, errors: 0 },
        }),
      );

      await storage.save(baselinePath, built);
      const loaded = await storage.load(baselinePath);

      expect(Object.keys(loaded).sort()).toEqual(['file1.ts', 'file2.ts']);
      expect(loaded['file2.ts'].totalWarnings).toBe(2);
    });

    it('handles empty files array without invoking analyzer', async () => {
      const storage = new BaselineStorage();
      const warningFn = vi.fn(async () => ({}));

      const result = await storage.initializeWithAnalyzer([], warningFn);

      expect(result).toEqual({});
      expect(warningFn).not.toHaveBeenCalled();
    });
  });
});
