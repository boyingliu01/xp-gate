import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { BaselineStorage, BaselineEntry } from '../baseline';

describe('Baseline Storage', () => {
  const mockBaselinePath = '.warnings-baseline.json';
  let baselineStorage: BaselineStorage;
  let originalAccess: any;
  let originalReadFile: any;
  let originalWriteFile: any;

  beforeEach(() => {
    baselineStorage = new BaselineStorage();
    originalAccess = fs.access;
    originalReadFile = fs.readFile;
    originalWriteFile = fs.writeFile;
  });

  afterEach(() => {
    (fs.access as any).mockRestore?.();
    (fs.readFile as any).mockRestore?.();
    (fs.writeFile as any).mockRestore?.();
    vi.resetAllMocks();
  });

  it('loads baseline from json file when exists', async () => {
    const mockBaseline = {
      'src/example.ts': {
        eslint: { warnings: 5, errors: 0 },
        totalWarnings: 5,
        lastAnalyzed: new Date().toISOString()
      }
    };

    vi.spyOn(fs, 'access').mockResolvedValue();
    vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockBaseline));

    const result = await baselineStorage.load(mockBaselinePath);
    expect(result).toEqual(mockBaseline);
  });

  it('returns empty baseline when file missing', async () => {
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('File does not exist'));

    const result = await baselineStorage.load(mockBaselinePath);
    expect(result).toEqual({});
  });

  it('saves updated baseline on pass', async () => {
    const mockBaseline = {
      'src/example.ts': {
        eslint: { warnings: 5, errors: 0 },
        totalWarnings: 5,
        lastAnalyzed: new Date().toISOString()
      }
    };

    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue();

    await baselineStorage.save(mockBaselinePath, mockBaseline);
    
    expect(writeFileSpy).toHaveBeenCalledWith(
      mockBaselinePath,
      JSON.stringify(mockBaseline, null, 2)
    );
  });

  it('handles large baselines efficiently', async () => {
    const largeBaseline: Record<string, BaselineEntry> = {};
    for (let i = 0; i < 100; i++) {
      largeBaseline[`src/component-${i}.ts`] = {
        eslint: { warnings: 2, errors: 0 },
        totalWarnings: 2,
        lastAnalyzed: new Date().toISOString()
      };
    }

    const spyOnWrite = vi.spyOn(fs, 'writeFile').mockResolvedValue();

    await baselineStorage.save(mockBaselinePath, largeBaseline);
    expect(spyOnWrite).toHaveBeenCalledWith(
      mockBaselinePath,
      expect.any(String)
    );
    
    const [calledWithPath, content] = spyOnWrite.mock.calls[0];
    expect(calledWithPath).toBe(mockBaselinePath);
    expect(JSON.parse(content as string)).toEqual(largeBaseline);
  });

  it('validates baseline with proper structure', () => {
    const validBaseline = {
      'src/file1.ts': {
        eslint: { warnings: 2, errors: 1 },
        principles: { warnings: 0, errors: 1 },
        ccn: { warnings: 0, max: 3 },
        totalWarnings: 2,
        lastAnalyzed: new Date().toISOString()
      }
    };

    expect(() => baselineStorage.validate(validBaseline)).not.toThrow();
  });

  it('throws error for invalid baseline', () => {
    const invalidBaseline = {
      'src/file1.ts': {
        totalWarnings: -5,
        lastAnalyzed: new Date().toISOString()
      }
    };

    expect(() => baselineStorage.validate(invalidBaseline)).toThrow();
  });

  it('filters baseline to include only files with warnings', () => {
    const baseline = {
      'src/clean1.ts': {
        eslint: { warnings: 0, errors: 0 },
        totalWarnings: 0,
        lastAnalyzed: new Date().toISOString()
      },
      'src/warning1.ts': {
        eslint: { warnings: 5, errors: 0 },
        totalWarnings: 5,
        lastAnalyzed: new Date().toISOString()
      },
      'src/clean2.ts': {
        eslint: { warnings: 0, errors: 0 },
        totalWarnings: 0,
        lastAnalyzed: new Date().toISOString()
      }
    };

    const filtered = baselineStorage.filterToIncludeOnlyFilesWithWarnings(baseline, 1);
    expect(Object.keys(filtered)).toHaveLength(1);
    expect(filtered['src/warning1.ts']).toBeDefined();
    expect(filtered['src/clean1.ts']).toBeUndefined();
    expect(filtered['src/clean2.ts']).toBeUndefined();
  });

  it('gets summary statistics', () => {
    const baseline = {
      'src/file1.ts': {
        eslint: { warnings: 2, errors: 1 },
        principles: { warnings: 1, errors: 0 },
        totalWarnings: 3,
        lastAnalyzed: new Date().toISOString()
      },
      'src/file2.ts': {
        eslint: { warnings: 4, errors: 0 },
        principles: { warnings: 0, errors: 2 },
        totalWarnings: 4,
        lastAnalyzed: new Date().toISOString()
      }
    };

    const stats = baselineStorage.getSummaryStatistics(baseline);
    
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalWarnings).toBe(7);
    expect(stats.averageWarningsPerFile).toBe(3.5);
    expect(stats.eslint?.totalWarnings).toBe(6);
    expect(stats.eslint?.totalErrors).toBe(1);
  });

  it('creates baseline from files with warning data', async () => {
    const warningData = [
      {
        file: 'src/example1.ts',
        counts: {
          eslint: { warnings: 2, errors: 1 },
          totalWarnings: 2
        }
      },
      {
        file: 'src/example2.ts',
        counts: {
          eslint: { warnings: 5, errors: 0 },
          principles: { warnings: 1, errors: 0 },
          totalWarnings: 6
        }
      }
    ];

    const result = await baselineStorage.createFromFiles(warningData);
    
    expect(Object.keys(result)).toEqual(['src/example1.ts', 'src/example2.ts']);
    expect(result['src/example1.ts'].totalWarnings).toBe(2);
    expect(result['src/example2.ts'].totalWarnings).toBe(6);
    expect(result['src/example1.ts'].eslint!.warnings).toBe(2);
  });
});