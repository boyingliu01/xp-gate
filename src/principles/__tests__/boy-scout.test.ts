import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    access: vi.fn(),
    writeFile: vi.fn(),
  };
});

vi.mock('../analyzer', () => ({
  analyze: vi.fn(),
  getAdapterForFile: vi.fn(),
}));

vi.mock('../index', () => ({
  getAllRules: vi.fn(() => []),
}));

import { readFile, access, writeFile } from 'fs/promises';
import {
  enforceBoyScoutRule,
  classifyFiles,
  calculateDelta,
  loadBaseline,
  saveBaseline,
  initBaseline,
  analyzeWarningsForFiles,
  autoInitBaseline,
  initBaselineCommand,
} from '../boy-scout';
import { analyze } from '../analyzer';
import { getAllRules } from '../index';

const mockAnalyze = vi.mocked(analyze);
const _mockGetAllRules = vi.mocked(getAllRules);
void _mockGetAllRules;
const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);
const mockWriteFile = vi.mocked(writeFile);

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface DeltaResult {
  file: string;
  status: 'NEW' | 'MODIFIED' | 'UNCHANGED';
  baselineWarnings: number;
  currentWarnings: number;
  delta: number;
  enforcement: 'PASS' | 'BLOCK';
  reason: string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * @test REQ-QG-002 Boy Scout Rule Enforcement
 * @intent Verify differential warning enforcement for historical projects
 * @covers AC-QG-002-01, AC-QG-002-02, AC-QG-002-03, AC-QG-002-04, AC-QG-002-05, AC-QG-002-06, AC-QG-002-07, AC-QG-002-08, AC-QG-002-09, AC-QG-002-10, AC-QG-002-11
 */
describe('Boy Scout Rule Enforcement', () => {
  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-01
   */
  describe('file classification', () => {
    it('identifies new files from git diff', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'M    src/existing-file.ts',
        'D    src/deleted-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual(['src/new-file.ts']);
    });
    
    it('identifies modified files from git diff', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'M    src/existing-file.ts',
        'D    src/deleted-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.modified).toEqual(['src/existing-file.ts']);
    });
    
    it('ignores deleted files', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'M    src/existing-file.ts',
        'D    src/deleted-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.deleted).toEqual(['src/deleted-file.ts']);
    });
    
    it('handles renamed files correctly', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'R095 old-file.ts src/new-renamed-file.ts',
        'M    src/existing-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.renamed).toEqual([
        { oldPath: 'old-file.ts', newPath: 'src/new-renamed-file.ts' }
      ]);
    });
    
    it('handles empty diff lines', () => {
      const gitDiff = [
        '',
        'A    src/new-file.ts',
        ' '
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual(['src/new-file.ts']);
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-02, AC-QG-002-03
   */
  describe('baseline management', () => {
    it('returns empty baseline when file missing', async () => {
      const baseline = await loadBaseline('.nonexistent-baseline.json');
      expect(baseline).toEqual({});
    });
    
    it('saves baseline to file', async () => {
      const testData: Record<string, BaselineEntry> = {
        'src/test.ts': { totalWarnings: 3, lastAnalyzed: new Date().toISOString() }
      };
      const testPath = '/tmp/test-baseline-save.json';

      vi.mocked(mockWriteFile).mockResolvedValue(undefined);

      await saveBaseline(testPath, testData);

      expect(mockWriteFile).toHaveBeenCalledWith(testPath, JSON.stringify(testData, null, 2));
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-04, AC-QG-002-05, AC-QG-002-06, AC-QG-002-07, AC-QG-002-08
   */
  describe('delta calculation', () => {
    it('returns delta = 0 for new files with zero warnings', () => {
      const result = calculateDelta(null, 0, 'NEW');
      expect(result.delta).toBe(0);
      expect(result.enforcement).toBe('PASS');
    });
    
    it('blocks new files with any warnings', () => {
      const result = calculateDelta(null, 3, 'NEW');
      expect(result.delta).toBe(3);
      expect(result.enforcement).toBe('BLOCK');
      expect(result.reason).toContain('New files must have zero warnings');
    });
    
    it('allows modified files with decreased warnings', () => {
      const result = calculateDelta({ totalWarnings: 10 } as BaselineEntry, 3, 'MODIFIED');
      expect(result.delta).toBe(-7);
      expect(result.enforcement).toBe('PASS');
    });
    
    it('allows modified files with same warnings (if >5)', () => {
      const result = calculateDelta({ totalWarnings: 10 } as BaselineEntry, 10, 'MODIFIED');
      expect(result.delta).toBe(0);
      expect(result.enforcement).toBe('PASS');
    });
    
    it('blocks modified files with increased warnings', () => {
      const result = calculateDelta({ totalWarnings: 2 } as BaselineEntry, 5, 'MODIFIED');
      expect(result.delta).toBe(3);
      expect(result.enforcement).toBe('BLOCK');
      expect(result.reason).toContain('Modified files cannot increase warnings');
    });
    
    it('blocks files with ≤5 warnings that dont clear to zero', () => {
      const baselineEntry = { totalWarnings: 3, lastAnalyzed: new Date().toISOString() } as BaselineEntry;      
      const result = calculateDelta(baselineEntry, 1, 'MODIFIED');
      expect(result.enforcement).toBe('BLOCK');
    });
    
    it('allows files with baseline ≤5 warnings to clear to zero warnings', () => {
      const baselineEntry = { totalWarnings: 3, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 0, 'MODIFIED');
      expect(result.enforcement).toBe('PASS');
    });
    
    it('passes modified file with auto-init (no baseline entry)', () => {
      const result = calculateDelta(null, 5, 'MODIFIED');
      expect(result.enforcement).toBe('PASS');
      expect(result.reason).toContain('baseline');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-11
   */
  describe('enforcement', () => {
    it('returns PASS for all clean files', () => {
      const deltas: DeltaResult[] = [
        { file: 'src/file1.ts', status: 'NEW', baselineWarnings: 0, currentWarnings: 0, delta: 0, enforcement: 'PASS', reason: 'Clean' },
        { file: 'src/file2.ts', status: 'MODIFIED', baselineWarnings: 5, currentWarnings: 3, delta: -2, enforcement: 'PASS', reason: 'Warnings decreased' }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.overallStatus).toBe('PASS');
      expect(result.violations).toEqual([]);
    });
    
    it('returns BLOCK when any file violates Boy Scout Rule', () => {
      const deltas: DeltaResult[] = [
        { file: 'src/new.ts', status: 'NEW', baselineWarnings: 0, currentWarnings: 0, delta: 0, enforcement: 'PASS', reason: '' },
        { file: 'src/bad.ts', status: 'NEW', baselineWarnings: 0, currentWarnings: 2, delta: 2, enforcement: 'BLOCK', reason: 'New files must have zero warnings' }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.overallStatus).toBe('BLOCK');
      expect(result.violations).toContainEqual(deltas[1]);
    });
    
    it('generates detailed delta report', () => {
      const deltas: DeltaResult[] = [
        { file: 'src/file.ts', status: 'NEW', baselineWarnings: 0, currentWarnings: 0, delta: 0, enforcement: 'PASS', reason: 'New file with zero warnings' }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.detailedReport).toEqual(deltas);
    });
    
    it('returns summary statistics', () => {
      const deltas: DeltaResult[] = [
        { file: 'src/good.ts', status: 'MODIFIED', baselineWarnings: 5, currentWarnings: 3, delta: -2, enforcement: 'PASS', reason: 'Warnings decreased' },
        { file: 'src/bad.ts', status: 'NEW', baselineWarnings: 0, currentWarnings: 2, delta: 2, enforcement: 'BLOCK', reason: 'New files must have zero warnings' }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.summary).toEqual({
        totalFiles: 2,
        passedFiles: 1,
        blockedFiles: 1
      });
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-09
   */
  describe('basic CLI functionality', () => {
    it('runs init via initBaseline', () => {
      expect(typeof initBaseline).toBe('function');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-07, AC-QG-002-08
   */
  describe('threshold enforcement', () => {
    it('blocks file with baseline=5 and current=1 (must clear to zero)', () => {
      const baselineEntry = { totalWarnings: 5, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 1, 'MODIFIED');
      expect(result.enforcement).toBe('BLOCK');
    });
    
    it('passes file with baseline=6 and current=5 (improvement)', () => {
      const baselineEntry = { totalWarnings: 6, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 5, 'MODIFIED');
      expect(result.enforcement).toBe('PASS');
    });
    
    it('passes file with baseline=5 and current=0 (cleared to zero)', () => {
      const baselineEntry = { totalWarnings: 5, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 0, 'MODIFIED');
      expect(result.enforcement).toBe('PASS');
    });
    
    it('blocks file with baseline=3 and current=3 (must clear)', () => {
      const baselineEntry = { totalWarnings: 3, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 3, 'MODIFIED');
      expect(result.enforcement).toBe('BLOCK');
    });
    
    it('allows file with baseline=8 and current=8 (no improvement needed)', () => {
      const baselineEntry = { totalWarnings: 8, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineEntry, 8, 'MODIFIED');
      expect(result.enforcement).toBe('PASS');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-02, AC-QG-002-03
   */
  describe('error handling', () => {
    it('handles empty file lists', () => {
      const result = enforceBoyScoutRule([]);
      expect(result.summary.totalFiles).toBe(0);
      expect(result.overallStatus).toBe('PASS');
    });
  });

  /**
   * @test REQ-4
   * @covers analyzeWarningsForFiles - lines 14-39
   */
  describe('analyzeWarningsForFiles', () => {
    it('returns empty object for empty string input', async () => {
      const result = await analyzeWarningsForFiles('');
      expect(result).toEqual({});
      expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('returns empty object for empty array input', async () => {
      const result = await analyzeWarningsForFiles([]);
      expect(result).toEqual({});
      expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('parses comma-separated string to file list', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts,src/b.ts');

      expect(mockAnalyze).toHaveBeenCalled();
      expect(result).toEqual({ 'src/a.ts': 0, 'src/b.ts': 0 });
    });

    it('accepts array input', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles(['src/a.ts', 'src/b.ts']);

      expect(mockAnalyze).toHaveBeenCalled();
      expect(result).toEqual({ 'src/a.ts': 0, 'src/b.ts': 0 });
    });

    it('counts warning violations per file', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
{ file: 'src/a.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
{ file: 'src/a.ts', line: 2, severity: 'warning' as const, ruleId: 'r2', message: 'm' },
{ file: 'src/b.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
{ file: 'src/a.ts', line: 3, severity: 'error' as const, ruleId: 'r3', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts,src/b.ts');

      expect(result['src/a.ts']).toBe(3);
      expect(result['src/b.ts']).toBe(1);
    });

    it('ignores info-level violations', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', line: 1, severity: 'info' as const, ruleId: 'r1', message: 'm' },
          { file: 'src/a.ts', line: 2, severity: 'warning' as const, ruleId: 'r2', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts');

      expect(result['src/a.ts']).toBe(1);
    });

    it('handles files not in the input list', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/unknown.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts');

      expect(result['src/a.ts']).toBe(0);
      expect(result['src/unknown.ts']).toBe(1);
    });

    it('handles whitespace in comma-separated strings', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('  src/a.ts , src/b.ts  ');

      expect(result).toHaveProperty('src/a.ts');
      expect(result).toHaveProperty('src/b.ts');
    });
  });

  /**
   * @test REQ-4
   * @covers loadBaseline with existing file, saveBaseline - lines 112-124
   */
  describe('loadBaseline', () => {
    it('loads and parses baseline from existing file', async () => {
      const mockData = { 'src/a.ts': { totalWarnings: 5, lastAnalized: '2024-01-01' } };

      (mockAccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(mockData));

      const result = await loadBaseline('/tmp/test-baseline.json');

      expect(result).toEqual(mockData);
      expect(mockAccess).toHaveBeenCalledWith('/tmp/test-baseline.json');
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/test-baseline.json', 'utf-8');
    });

    it('returns empty object when file does not exist', async () => {
      (mockAccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await loadBaseline('/tmp/nonexistent.json');

      expect(result).toEqual({});
    });

    it('returns empty object when JSON parse fails', async () => {
      (mockAccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('not json');

      const result = await loadBaseline('/tmp/bad.json');

      expect(result).toEqual({});
    });
  });

  /**
   * @test REQ-4
   * @covers initBaseline, autoInitBaseline, initBaselineCommand - lines 201-244, 331-334
   */
  describe('init and auto-init baseline', () => {
    it('returns baseline with warning counts for files with violations', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
          { file: 'src/a.ts', line: 2, severity: 'warning' as const, ruleId: 'r2', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await initBaseline(['src/a.ts', 'src/b.ts']);

      expect(result['src/a.ts'].totalWarnings).toBe(2);
      expect(result).not.toHaveProperty('src/b.ts');
    });

    it('only includes files with warnings > 0', async () => {
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await initBaseline(['src/a.ts', 'src/b.ts']);
      expect(Object.keys(result)).toEqual([]);
    });

    it('handles empty file list', async () => {
      const result = await initBaseline([]);
      expect(result).toEqual({});
    });

    it('sets lastAnalyzed to current date', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, ruleId: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const before = new Date().toISOString();
      const result = await initBaseline(['src/a.ts']);
      const after = new Date().toISOString();

      expect(result['src/a.ts'].lastAnalyzed >= before).toBe(true);
      expect(result['src/a.ts'].lastAnalyzed <= after).toBe(true);
    });

    it('rethrows when analyzeWarningsForFiles fails globally', async () => {
      mockAnalyze.mockRejectedValue(new Error('analyze failed'));
      await expect(initBaseline(['src/fail.ts'])).rejects.toThrow('analyze failed');
    });

    it('analyzes files and saves baseline', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, ruleId: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await autoInitBaseline(['src/a.ts'], '/tmp/auto-baseline.json');
      expect(result['src/a.ts'].totalWarnings).toBe(1);
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/auto-baseline.json', expect.stringContaining('src/a.ts'));
    });

    it('does not include files with zero warnings', async () => {
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await autoInitBaseline(['src/a.ts'], '/tmp/auto-baseline.json');
      expect(Object.keys(result)).toEqual([]);
    });

    it('handles files with warnings mixed with files without', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/warn.ts', severity: 'warning' as const, ruleId: 'r1', message: 'm' },
          { file: 'src/warn.ts', severity: 'warning' as const, ruleId: 'r2', message: 'm' },
          { file: 'src/warn.ts', severity: 'error' as const, ruleId: 'r3', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await autoInitBaseline(['src/warn.ts', 'src/clean.ts'], '/tmp/auto.json');
      expect(result['src/warn.ts'].totalWarnings).toBe(3);
      expect(result).not.toHaveProperty('src/clean.ts');
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('calls initBaseline and saves with default path', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, ruleId: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      await initBaselineCommand(['src/a.ts']);
      expect(mockWriteFile).toHaveBeenCalledWith('.warnings-baseline.json', expect.stringContaining('src/a.ts'));
    });

    it('saves baseline even when there are no warnings', async () => {
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      await initBaselineCommand(['src/clean.ts']);
      expect(mockWriteFile).toHaveBeenCalledWith('.warnings-baseline.json', expect.any(String));
      const savedJson = JSON.parse(vi.mocked(mockWriteFile).mock.calls[0][1] as string);
      expect(Object.keys(savedJson)).toEqual([]);
    });
  });
});
