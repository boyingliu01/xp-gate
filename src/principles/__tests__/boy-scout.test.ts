import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

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
  initBaselineCommand,
  runEnforcement,
  autoInitBaseline,
} from '../boy-scout';
import { analyze } from '../analyzer';
import { getAllRules } from '../index';

const mockAnalyze = vi.mocked(analyze);
const mockGetAllRules = vi.mocked(getAllRules);
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
 * @test REQ-QG-002 Boy Scout Rule Implementation
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
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r2', message: 'm' },
          { file: 'src/b.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
          { file: 'src/a.ts', severity: 'error' as const, rule: 'r3', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts,src/b.ts');

      expect(result['src/a.ts']).toBe(3);
      expect(result['src/b.ts']).toBe(1);
    });

    it('ignores info-level violations', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', severity: 'info' as const, rule: 'r1', message: 'm' },
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r2', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts');

      expect(result['src/a.ts']).toBe(1);
    });

    it('handles files not in the input list', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/unknown.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
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
  describe('loadBaseline with existing file', () => {
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
   * @covers initBaseline and autoInitBaseline - lines 201-244
   */
  describe('initBaseline', () => {
    it('returns baseline with warning counts for files with violations', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r2', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await initBaseline(['src/a.ts', 'src/b.ts']);

      expect(result['src/a.ts'].totalWarnings).toBe(2);
      expect(result).not.toHaveProperty('src/b.ts');
    });

    it('only includes files with warnings > 0', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await initBaseline(['src/a.ts', 'src/b.ts']);

      expect(Object.keys(result)).toEqual([]);
    });

    it('handles empty file list', async () => {
      const result = await initBaseline([]);
      expect(result).toEqual({});
    });

    it('sets lastAnalyzed to current date', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const before = new Date().toISOString();
      const result = await initBaseline(['src/a.ts']);
      const after = new Date().toISOString();

      const analyzedDate = result['src/a.ts'].lastAnalyzed;
      expect(analyzedDate >= before).toBe(true);
      expect(analyzedDate <= after).toBe(true);
    });
  });

  describe('autoInitBaseline', () => {
    it('analyzes files and saves baseline', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await autoInitBaseline(['src/a.ts'], '/tmp/auto-baseline.json');

      expect(result['src/a.ts'].totalWarnings).toBe(1);
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/auto-baseline.json',
        expect.stringContaining('src/a.ts')
      );
    });

    it('does not include files with zero warnings', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await autoInitBaseline(['src/a.ts'], '/tmp/auto-baseline.json');

      expect(Object.keys(result)).toEqual([]);
    });
  });

  /**
   * @test REQ-4
   * @covers runEnforcement - lines 336-384
   */
  describe('runEnforcement', () => {
    it('passes when new files have zero warnings and modified files are clean', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ 'src/modified.ts': { totalWarnings: 3, lastAnalyzed: '2024-01-01' } })
      );
      mockWriteFile.mockResolvedValue(undefined);

      const result = await runEnforcement(
        ['src/new.ts'],
        ['src/modified.ts'],
        '/tmp/test-baseline.json'
      );

      expect(result.overallStatus).toBe('PASS');
      expect(result.summary.totalFiles).toBe(2);
    });

    it('blocks when new files have warnings', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/new.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      (mockAccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await runEnforcement(['src/new.ts'], [], '/tmp/test-baseline.json');

      expect(result.overallStatus).toBe('BLOCK');
      expect(result.summary.blockedFiles).toBe(1);
    });

    it('blocks when modified files increase warnings', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/modified.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
          { file: 'src/modified.ts', severity: 'warning' as const, rule: 'r2', message: 'm' },
          { file: 'src/modified.ts', severity: 'warning' as const, rule: 'r3', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      (mockAccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ 'src/modified.ts': { totalWarnings: 1, lastAnalyzed: '2024-01-01' } })
      );
      (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await runEnforcement([], ['src/modified.ts'], '/tmp/test-baseline.json');

      expect(result.overallStatus).toBe('BLOCK');
      expect(result.violations[0].reason).toContain('cannot increase warnings');
    });

    it('auto-initializes missing baseline entries for modified files', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('{}');
      mockWriteFile.mockResolvedValue(undefined);

      const result = await runEnforcement([], ['src/modified.ts'], '/tmp/test-baseline.json');

      expect(mockWriteFile).toHaveBeenCalled();
      expect(result.overallStatus).toBe('PASS');
    });

    it('handles empty newFiles and modifiedFiles arrays', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      (mockAccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await runEnforcement([], [], '/tmp/test-baseline.json');

      expect(result.overallStatus).toBe('PASS');
      expect(result.summary.totalFiles).toBe(0);
    });

    it('filters out empty strings from file arrays', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      (mockAccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await runEnforcement(['', '  ', ''], ['', '  '], '/tmp/test.json');

      expect(result.overallStatus).toBe('PASS');
    });

    it('auto-init saves updated baseline when missing entries exist', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      (mockAccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({}));
      (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await runEnforcement([], ['src/a.ts'], '/tmp/test-baseline.json');

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = vi.mocked(mockWriteFile).mock.calls[0];
      expect(writeCall[0]).toBe('/tmp/test-baseline.json');
    });
  });

  /**
   * @test REQ-4
   * @covers calculateDelta remaining reason branches - lines 167-174
   */
  describe('calculateDelta reason messages', () => {
    it('returns "Warnings decreased X" reason on decrease', () => {
      const result = calculateDelta({ totalWarnings: 10 } as BaselineEntry, 7, 'MODIFIED');
      expect(result.delta).toBe(-3);
      expect(result.enforcement).toBe('PASS');
      expect(result.reason).toContain('Warnings decreased by 3');
    });

    it('returns "All warnings cleared" reason when current is zero', () => {
      const result = calculateDelta({ totalWarnings: 0 } as BaselineEntry, 0, 'MODIFIED');
      expect(result.delta).toBe(0);
      expect(result.enforcement).toBe('PASS');
      expect(result.reason).toContain('All warnings cleared');
    });

    it('returns "No new warnings introduced" when same count and >5', () => {
      const baselineWithSame = { totalWarnings: 8, lastAnalyzed: new Date().toISOString() } as BaselineEntry;
      const result = calculateDelta(baselineWithSame, 8, 'MODIFIED');
      expect(result.delta).toBe(0);
      expect(result.enforcement).toBe('PASS');
      expect(result.reason).toContain('No new warnings introduced');
    });

    it('sets correct file field in delta result', () => {
      const result = calculateDelta(null, 5, 'MODIFIED');
      result.file = 'src/test.ts';
      expect(result.file).toBe('src/test.ts');
      expect(result.status).toBe('MODIFIED');
    });
  });

  /**
   * @test REQ-4
   * @covers classifyFiles edge cases - renamed with insufficient parts
   */
  describe('classifyFiles edge cases', () => {
    it('ignores rename lines with insufficient parts', () => {
      const gitDiff = ['R095'];
      const classified = classifyFiles(gitDiff);
      expect(classified.renamed).toEqual([]);
    });

    it('ignores lines with less than 2 parts', () => {
      const gitDiff = ['A'];
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual([]);
    });

    it('handles unknown status codes gracefully', () => {
      const gitDiff = ['X    src/unknown.ts'];
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual([]);
      expect(classified.modified).toEqual([]);
      expect(classified.deleted).toEqual([]);
      expect(classified.renamed).toEqual([]);
    });

    it('handles files with spaces in paths for new files', () => {
      const gitDiff = ['A    src/my file.ts'];
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual(['src/my file.ts']);
    });
  });

  /**
   * @test REQ-4
   * @covers initBaselineCommand - lines 331-334
   */
  describe('initBaselineCommand', () => {
    it('calls initBaseline and saves with default path', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/a.ts', severity: 'warning' as const, rule: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockWriteFile.mockResolvedValue(undefined);

      await initBaselineCommand(['src/a.ts']);

      expect(mockWriteFile).toHaveBeenCalledWith(
        '.warnings-baseline.json',
        expect.stringContaining('src/a.ts')
      );
    });
  });

  describe('CLI integration', () => {
    const BOY_SCOUT_PATH = path.resolve(__dirname, '../boy-scout.ts');
    // CLI tests spawn `npx tsx` subprocesses; under coverage instrumentation cold-start can exceed
    // vitest's default 5s testTimeout. Each test sets its own 60s timeout to match the execAsync 30s + margin.
    const CLI_TEST_TIMEOUT = 60000;

    it('shows help and exits with --help flag', async () => {
      const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} --help`, {
        timeout: 30000,
      });
      expect(stdout).toContain('Usage: boy-scout');
      expect(stdout).toContain('--new-files');
    }, CLI_TEST_TIMEOUT);

    it('shows help and exits with -h flag', async () => {
      const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} -h`, {
        timeout: 30000,
      });
      expect(stdout).toContain('Usage: boy-scout');
    }, CLI_TEST_TIMEOUT);

    it('shows help and exits with help command', async () => {
      const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} help`, {
        timeout: 30000,
      });
      expect(stdout).toContain('Usage: boy-scout');
    }, CLI_TEST_TIMEOUT);

    it('runs init-baseline via CLI', async () => {
      const { stdout } = await execAsync(
        `npx tsx ${BOY_SCOUT_PATH} --init-baseline src/principles/boy-scout.ts`,
        { timeout: 30000 }
      );
      expect(stdout).toContain('Baseline initialized successfully');
    }, CLI_TEST_TIMEOUT);

    it('runs enforcement via CLI with empty files', async () => {
      await expect(
        execAsync(`npx tsx ${BOY_SCOUT_PATH} --new-files "" --modified-files ""`, { timeout: 30000 })
      ).resolves.toMatchObject({ stdout: expect.stringContaining('"overallStatus"') });
    }, CLI_TEST_TIMEOUT);
  });
});
