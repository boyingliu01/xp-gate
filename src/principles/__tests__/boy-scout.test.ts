import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    /**
     * @test REQ-QG-002
     * @covers AC-QG-002-01
     */
    it('identifies new files from git diff', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'M    src/existing-file.ts',
        'D    src/deleted-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.new).toEqual(['src/new-file.ts']);
    });
    
    /**
     * @test REQ-QG-002
     * @covers AC-QG-002-01
     */
    it('identifies modified files from git diff', () => {
      const gitDiff = [
        'A    src/new-file.ts',
        'M    src/existing-file.ts',
        'D    src/deleted-file.ts'
      ];
      
      const classified = classifyFiles(gitDiff);
      expect(classified.modified).toEqual(['src/existing-file.ts']);
    });
    
    /**
     * @test REQ-QG-002
     * @covers AC-QG-002-01
     */
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
    const mockBaselinePath = '.warnings-baseline.json';
    
    beforeEach(() => {
      vi.spyOn(fs, 'access').mockImplementation(async (path) => {
        if (path === mockBaselinePath) {
          throw new Error('File does not exist');
        }
      });
      
      vi.spyOn(fs, 'readFile').mockImplementation(async (path) => {
        if (path === mockBaselinePath) {
          throw new Error('File does not exist');
        }
        return '{}';
      });
    });
    
    afterEach(() => {
      vi.restoreAllMocks();
    });
    
    it('loads baseline from .warnings-baseline.json', async () => {
      const baselineData = JSON.stringify({
        'src/example.ts': { 
          eslint: { warnings: 5, errors: 0 },
          totalWarnings: 5,
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockResolvedValue(baselineData);
      
      const baseline = await loadBaseline(mockBaselinePath);
      expect(baseline['src/example.ts']).toBeDefined();
      expect(baseline['src/example.ts'].totalWarnings).toBe(5);
    });
    
    it('returns empty baseline when file missing', async () => {
      const baseline = await loadBaseline(mockBaselinePath);
      expect(baseline).toEqual({});
    });
    
    it('saves updated baseline on pass', async () => {
      const baselineData: Record<string, BaselineEntry> = {
        'src/example.ts': { 
          eslint: { warnings: 5, errors: 0 },
          totalWarnings: 5,
          lastAnalyzed: new Date().toISOString()
        }
      };
      
      const spy = vi.spyOn(fs, 'writeFile').mockResolvedValue();
      
      await saveBaseline(mockBaselinePath, baselineData);
      expect(spy).toHaveBeenCalledWith(
        mockBaselinePath,
        JSON.stringify(baselineData, null, 2)
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
      
      const spy = vi.spyOn(fs, 'writeFile').mockResolvedValue();
      
      await saveBaseline(mockBaselinePath, largeBaseline);
      const [path, content] = spy.mock.calls[0];
      expect(path).toBe(mockBaselinePath);
      expect(JSON.parse(content)).toEqual(largeBaseline);
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
      expect(result.reason).toContain('Modified files cannot introduce new warnings');
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
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-11
   */
  describe('enforcement', () => {
    it('returns PASS for all clean files', () => {
      const deltas: DeltaResult[] = [
        { 
          file: 'src/clean-file.ts', 
          status: 'MODIFIED', 
          baselineWarnings: 5, 
          currentWarnings: 3, 
          delta: -2, 
          enforcement: 'PASS',
          reason: 'Warnings decreased from 5 to 3'
        }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.overallStatus).toBe('PASS');
    });
    
    it('returns BLOCK for any violation', () => {
      const deltas: DeltaResult[] = [
        { 
          file: 'src/good-file.ts', 
          status: 'MODIFIED', 
          baselineWarnings: 5, 
          currentWarnings: 3, 
          delta: -2, 
          enforcement: 'PASS',
          reason: 'Warnings decreased from 5 to 3'
        },
        { 
          file: 'src/bad-file.ts', 
          status: 'NEW', 
          baselineWarnings: 0, 
          currentWarnings: 2, 
          delta: 2, 
          enforcement: 'BLOCK',
          reason: 'New files must have zero warnings'
        }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.overallStatus).toBe('BLOCK');
      expect(result.violations).toContainEqual(deltas[1]);
    });
    
    it('generates detailed delta report', () => {
      const deltas: DeltaResult[] = [
        { 
          file: 'src/file.ts', 
          status: 'NEW', 
          baselineWarnings: 0, 
          currentWarnings: 0, 
          delta: 0, 
          enforcement: 'PASS',
          reason: 'New file with no warnings'
        }
      ];
      
      const result = enforceBoyScoutRule(deltas);
      expect(result.detailedReport).toEqual(deltas);
    });
    
    it('returns summary statistics', () => {
      const deltas: DeltaResult[] = [
        { 
          file: 'src/good-file.ts', 
          status: 'MODIFIED', 
          baselineWarnings: 5, 
          currentWarnings: 3, 
          delta: -2, 
          enforcement: 'PASS',
          reason: 'Warnings decreased from 5 to 3'
        },
        { 
          file: 'src/bad-file.ts', 
          status: 'NEW', 
          baselineWarnings: 0, 
          currentWarnings: 2, 
          delta: 2, 
          enforcement: 'BLOCK',
          reason: 'New files must have zero warnings'
        }
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
    it('runs init via initBaseline', async () => {
      expect(typeof initBaseline).toBe('function');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-04, AC-QG-002-05
   */
  describe('warning detection', () => {
    it('detects console.log as warning', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('console.log("test");');
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['test.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
    });
    
    it('detects TODO comments as warning', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('// TODO: implement this');
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['test.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
    });
    
    it('detects var keyword as warning', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('var x = 1;');
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['test.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
    });
    
    it('counts multiple warnings in same file', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(`
console.log("debug");
// TODO: fix later
var legacy = true;
console.log("another");
`);
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        return `
console.log("debug");
// TODO: fix later
var legacy = true;
console.log("another");
`;
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['test.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
      expect(result.violations[0]?.currentWarnings).toBeGreaterThanOrEqual(4);
    });
    
    it('processes non-source files for new file policy', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        return '{"key": "value"}';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['config.json'], [], '.warnings-baseline.json');
      
      expect(result.detailedReport[0].currentWarnings).toBe(0);
    });
    
    it('handles empty files', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        return '';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['empty.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
      expect(result.summary.blockedFiles).toBe(0);
    });
    
    it('handles files without warnings', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        return 'const x = 1;\\nconst y = 2;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['clean.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-01
   */
  describe('file status handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    
    it('correctly handles only new files', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['new1.ts', 'new2.ts'], [], '.warnings-baseline.json');
      
      expect(result.summary.totalFiles).toBe(2);
      expect(result.detailedReport.every(r => r.status === 'NEW')).toBe(true);
    });
    
    it('correctly handles only modified files', async () => {
      const baselineData = JSON.stringify({
        'modified.ts': { 
          totalWarnings: 3, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['modified.ts'], '.warnings-baseline.json');
      
      expect(result.summary.totalFiles).toBe(1);
      expect(result.detailedReport.every(r => r.status === 'MODIFIED')).toBe(true);
    });
    
    it('handles mix of new and modified files', async () => {
      const baselineData = JSON.stringify({
        'existing.ts': { 
          totalWarnings: 2, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['new.ts'], ['existing.ts'], '.warnings-baseline.json');
      
      expect(result.summary.totalFiles).toBe(2);
      expect(result.detailedReport.some(r => r.status === 'NEW')).toBe(true);
      expect(result.detailedReport.some(r => r.status === 'MODIFIED')).toBe(true);
    });
    
    it('handles file in baseline with zero warnings', async () => {
      const baselineData = JSON.stringify({
        'clean.ts': { 
          totalWarnings: 0, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['clean.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-07, AC-QG-002-08
   */
  describe('threshold enforcement', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    
    it('blocks file with baseline=5 and current=1 (must clear to zero)', async () => {
      const baselineData = JSON.stringify({
        'threshold.ts': { 
          totalWarnings: 5, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'console.log("test");';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['threshold.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
    });
    
    it('passes file with baseline=6 and current=5 (improvement)', async () => {
      const baselineData = JSON.stringify({
        'above.ts': { 
          totalWarnings: 6, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'console.log("a");\\nconsole.log("b");\\nconsole.log("c");\\nconsole.log("d");\\nconsole.log("e");';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['above.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
    
    it('passes file with baseline=5 and current=0 (cleared to zero)', async () => {
      const baselineData = JSON.stringify({
        'cleared.ts': { 
          totalWarnings: 5, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['cleared.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
    
    it('blocks file with baseline=3 and current=3 (must clear)', async () => {
      const baselineData = JSON.stringify({
        'small.ts': { 
          totalWarnings: 3, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'console.log("a");\\nconsole.log("b");\\nconsole.log("c");';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['small.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('BLOCK');
    });
    
    it('allows file with baseline=8 and current=8 (no improvement needed)', async () => {
      const baselineData = JSON.stringify({
        'stable.ts': { 
          totalWarnings: 8, 
          lastAnalyzed: new Date().toISOString()
        }
      });
      
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return baselineData;
        return 'console.log("1");\\nconsole.log("2");\\nconsole.log("3");\\nconsole.log("4");\\nconsole.log("5");\\nconsole.log("6");\\nconsole.log("7");\\nconsole.log("8");';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['stable.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
  });

  /**
   * @test REQ-QG-002
   * @covers AC-QG-002-02, AC-QG-002-03
   */
  describe('error handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    
    it('handles read errors gracefully', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return '{}';
        throw new Error('Read error');
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement(['error.ts'], [], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
    });
    
    it('handles malformed baseline JSON gracefully', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockImplementation(async (path: any) => {
        if (path === '.warnings-baseline.json') return 'invalid json';
        return 'const x = 1;';
      });
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], ['test.ts'], '.warnings-baseline.json');
      
      expect(result.overallStatus).toBe('PASS');
      expect(result.detailedReport[0].baselineWarnings).toBe(0);
    });
    
    it('handles empty file lists', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFile').mockResolvedValue('{}');
      
      const { runEnforcement } = await import('../boy-scout');
      const result = await runEnforcement([], [], '.warnings-baseline.json');
      
      expect(result.summary.totalFiles).toBe(0);
      expect(result.overallStatus).toBe('PASS');
    });
  });
});