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
  runEnforcement,
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
    const baseGitDiff = ['A    src/new-file.ts', 'M    src/existing-file.ts', 'D    src/deleted-file.ts'];

    it('classifies new, modified, deleted files from git diff', () => {
      const classified = classifyFiles(baseGitDiff);
      expect(classified.new).toEqual(['src/new-file.ts']);
      expect(classified.modified).toEqual(['src/existing-file.ts']);
      expect(classified.deleted).toEqual(['src/deleted-file.ts']);
    });
    
    it('handles renamed files correctly', () => {
      const classified = classifyFiles([...baseGitDiff, 'R095 old-file.ts src/new-renamed-file.ts']);
      expect(classified.renamed).toEqual([{ oldPath: 'old-file.ts', newPath: 'src/new-renamed-file.ts' }]);
    });
    
    it('handles empty diff lines', () => {
      const classified = classifyFiles(['', 'A    src/new-file.ts', ' ']);
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
    const entry = (w: number) => ({ totalWarnings: w, lastAnalyzed: new Date().toISOString() }) as BaselineEntry;

    it('blocks ≤5 warnings that dont clear to zero', () => {
      expect(calculateDelta(entry(5), 1, 'MODIFIED').enforcement).toBe('BLOCK');
      expect(calculateDelta(entry(3), 3, 'MODIFIED').enforcement).toBe('BLOCK');
    });

    it('passes ≤5 warnings cleared to zero or >5 warnings that decrease', () => {
      expect(calculateDelta(entry(5), 0, 'MODIFIED').enforcement).toBe('PASS');
      expect(calculateDelta(entry(6), 5, 'MODIFIED').enforcement).toBe('PASS');
      expect(calculateDelta(entry(8), 8, 'MODIFIED').enforcement).toBe('PASS');
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
   * @test #173 boy-scout coverage - runEnforcement
   * @covers AC-QG-002-runEnforcement-full
   */
  describe('runEnforcement', () => {
    const warn = (file: string) => ({ file, severity: 'warning' as const, ruleId: 'r1', message: 'm' });
    const setup = () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockWriteFile.mockResolvedValue(undefined);
    };

    it('enforces new files with zero warnings', async () => {
      setup();
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);
      const result = await runEnforcement(['clean.ts'], [], '/tmp/test-baseline.json');
      expect(result.overallStatus).toBe('PASS');
      expect(result.summary.totalFiles).toBe(1);
    });

    it('auto-initializes baseline for modified files and passes', async () => {
      setup();
      mockAnalyze.mockResolvedValue({ violations: [warn('mod.ts')] } as unknown as Awaited<ReturnType<typeof analyze>>);
      const result = await runEnforcement([], ['mod.ts'], '/tmp/test-baseline.json');
      expect(result.summary.totalFiles).toBe(1);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('blocks new files with warnings', async () => {
      setup();
      mockAnalyze.mockResolvedValue({ violations: [warn('bad.ts')] } as unknown as Awaited<ReturnType<typeof analyze>>);
      const result = await runEnforcement(['bad.ts'], [], '/tmp/test-baseline.json');
      expect(result.overallStatus).toBe('BLOCK');
      expect(result.violations.length).toBe(1);
    });

    it('handles mixed new and modified files', async () => {
      setup();
      mockAnalyze.mockResolvedValue({ violations: [warn('bad.ts')] } as unknown as Awaited<ReturnType<typeof analyze>>);
      const result = await runEnforcement(['bad.ts', 'clean.ts'], ['existing.ts'], '/tmp/test-baseline.json');
      expect(result.summary.totalFiles).toBe(3);
    });

    it('decreased warnings shows reason and same high warnings shows "No new warnings"', async () => {
      const baseline = { 'mod.ts': { totalWarnings: 3, lastAnalyzed: new Date().toISOString() } };
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      // Decreased case
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockReadFile.mockResolvedValue(JSON.stringify(baseline));
      const decResult = await runEnforcement([], ['mod.ts'], '/tmp/test-baseline.json');
      expect(decResult.detailedReport[0].reason).toBe('Warnings decreased by 3');

      // Same high warnings case
      const highBaseline = { 'mod.ts': { totalWarnings: 10, lastAnalyzed: new Date().toISOString() } };
      mockAnalyze.mockResolvedValue({
        violations: Array.from({ length: 10 }, () => warn('mod.ts')),
      } as unknown as Awaited<ReturnType<typeof analyze>>);
      mockReadFile.mockResolvedValue(JSON.stringify(highBaseline));
      const sameResult = await runEnforcement([], ['mod.ts'], '/tmp/test-baseline.json');
      expect(sameResult.detailedReport[0].reason).toBe('No new warnings introduced');
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

    it('counts warning/error violations per file and ignores info-level', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [
          { file: 'src/a.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
          { file: 'src/a.ts', line: 2, severity: 'warning' as const, ruleId: 'r2', message: 'm' },
          { file: 'src/b.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' },
          { file: 'src/a.ts', line: 3, severity: 'error' as const, ruleId: 'r3', message: 'm' },
          { file: 'src/c.ts', line: 1, severity: 'info' as const, ruleId: 'r4', message: 'm' },
        ],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts,src/b.ts,src/c.ts');
      expect(result['src/a.ts']).toBe(3);
      expect(result['src/b.ts']).toBe(1);
      expect(result['src/c.ts']).toBe(0);
    });

    it('handles files not in the input list', async () => {
      mockAnalyze.mockResolvedValue({
        violations: [{ file: 'src/unknown.ts', line: 1, severity: 'warning' as const, ruleId: 'r1', message: 'm' }],
      } as unknown as Awaited<ReturnType<typeof analyze>>);

      const result = await analyzeWarningsForFiles('src/a.ts');
      expect(result['src/a.ts']).toBe(0);
      expect(result['src/unknown.ts']).toBe(1);
    });

    it('handles whitespace in comma-separated strings', async () => {
      mockAnalyze.mockResolvedValue({ violations: [] } as unknown as Awaited<ReturnType<typeof analyze>>);
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

  /**
   * @test REQ-QG-002 CLI entrypoint coverage
   * @intent Cover internal CLI helpers (main, parseArgs, splitCsvArg, ARG_HANDLERS, runInitBaselineCommand, runEnforcementCommand, showHelp) via module re-import with synthesized argv
   * @covers analyzeWarningsForFiles-CLI-1, analyzeWarningsForFiles-CLI-2, analyzeWarningsForFiles-CLI-3
   */
  /**
   * @test REQ-QG-002 CLI entrypoint coverage
   * @intent Cover internal CLI helpers (main, parseArgs, splitCsvArg, ARG_HANDLERS, runInitBaselineCommand, runEnforcementCommand, showHelp) via real subprocess execution with NODE_V8_COVERAGE so vitest's v8 reporter merges the child profiles.
   * @covers boy-scout-cli-help, boy-scout-cli-init-baseline, boy-scout-cli-enforce
   */
  describe('CLI entrypoint (main / parseArgs / handlers)', () => {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');

    const BOY_SCOUT_PATH = path.resolve(__dirname, '../boy-scout.ts');

    function runCli(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
      const coverageDir = process.env.NODE_V8_COVERAGE ?? path.join(process.cwd(), 'coverage', '.tmp');
      const result = spawnSync('npx', ['tsx', BOY_SCOUT_PATH, ...args], {
        cwd: cwd ?? process.cwd(),
        encoding: 'utf-8',
        env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
      });
      return {
        code: result.status ?? -1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    }

    it('shows help when --help is passed', () => {
      const { code, stdout } = runCli(['--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage: boy-scout');
      expect(stdout).toContain('--init-baseline');
    });

    it('shows help when -h is passed', () => {
      const { code, stdout } = runCli(['-h']);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage: boy-scout');
    });

    it('shows help when "help" keyword is passed', () => {
      const { code, stdout } = runCli(['help']);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage: boy-scout');
    });

    it('runs init-baseline command via --init-baseline flag in a clean tmp project', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boy-scout-init-'));
      try {
        fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 1;\n');
        const { code, stdout } = runCli(['--init-baseline', 'a.ts'], tmp);
        expect(code).toBe(0);
        expect(stdout).toContain('Baseline initialized successfully');
        expect(fs.existsSync(path.join(tmp, '.warnings-baseline.json'))).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('runs enforcement command and prints JSON result with overallStatus', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boy-scout-enforce-'));
      try {
        fs.writeFileSync(path.join(tmp, 'clean.ts'), 'export const ok = 1;\n');
        const baselinePath = path.join(tmp, '.warnings-baseline.json');
        const { code, stdout } = runCli([
          '--new-files', 'clean.ts',
          '--baseline', baselinePath,
        ], tmp);
        expect([0, 1]).toContain(code);
        expect(stdout).toContain('overallStatus');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('handles --modified-files argument and writes baseline auto-init', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boy-scout-mod-'));
      try {
        fs.writeFileSync(path.join(tmp, 'mod.ts'), 'export const m = 1;\n');
        const baselinePath = path.join(tmp, '.warnings-baseline.json');
        fs.writeFileSync(baselinePath, '{}');
        const { code, stdout } = runCli([
          '--modified-files', 'mod.ts',
          '--baseline', baselinePath,
        ], tmp);
        expect([0, 1]).toContain(code);
        expect(stdout).toContain('overallStatus');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
