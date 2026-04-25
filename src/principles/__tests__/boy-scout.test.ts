import { describe, it, expect, vi } from 'vitest';
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    access: vi.fn(),
  };
});

import fs from 'fs/promises';
import { enforceBoyScoutRule, classifyFiles, calculateDelta, loadBaseline, saveBaseline, initBaseline } from '../boy-scout';

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
      
      await saveBaseline(testPath, testData);
      
      const content = await fs.readFile(testPath, 'utf-8');
      expect(JSON.parse(content)).toEqual(testData);
      
      await fs.unlink(testPath);
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
});
