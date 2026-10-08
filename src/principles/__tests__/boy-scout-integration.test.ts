import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

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
  classifyFiles,
  calculateDelta,
  runEnforcement,
} from '../boy-scout';
import { analyze } from '../analyzer';

const mockAnalyze = vi.mocked(analyze);
const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);
const mockWriteFile = vi.mocked(writeFile);

interface BaselineEntry {
  totalWarnings: number;
  lastAnalyzed: string;
}

type AnalysisResult = Awaited<ReturnType<typeof analyze>>;

const emptyAnalysis = (): AnalysisResult => ({ violations: [] } as unknown as AnalysisResult);

function fakeAnalysis(violations: Partial<AnalysisResult['violations']>[number][]): AnalysisResult {
  return { violations: violations as unknown as AnalysisResult['violations'] } as unknown as AnalysisResult;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * @test REQ-59 Boy Scout Rule integration tests
 * @intent Verify runEnforcement, CLI integration, and edge cases for Boy Scout Rule
 * @covers AC-59-01
 */
describe('Boy Scout Rule - runEnforcement', () => {
  it('passes when new files have zero warnings and modified files are clean', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'src/modified.ts': { totalWarnings: 3, lastAnalyzed: '2024-01-01' } })
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement(['src/new.ts'], ['src/modified.ts'], '/tmp/test-baseline.json');

    expect(result.overallStatus).toBe('PASS');
    expect(result.summary.totalFiles).toBe(2);
  });

  it('blocks when new files have warnings', async () => {
    mockAnalyze.mockResolvedValue(
      fakeAnalysis([{ file: 'src/new.ts', line: 1, ruleId: 'test', severity: 'warning' as const, message: 'm' }])
    );
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement(['src/new.ts'], [], '/tmp/test-baseline.json');

    expect(result.overallStatus).toBe('BLOCK');
    expect(result.summary.blockedFiles).toBe(1);
  });

  it('blocks when modified files increase warnings', async () => {
    mockAnalyze.mockResolvedValue(
      fakeAnalysis([
        { file: 'src/modified.ts', line: 1, ruleId: 'test', severity: 'warning' as const, message: 'm' },
        { file: 'src/modified.ts', line: 2, ruleId: 'test', severity: 'warning' as const, message: 'm' },
        { file: 'src/modified.ts', line: 3, ruleId: 'test', severity: 'warning' as const, message: 'm' },
      ])
    );
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'src/modified.ts': { totalWarnings: 1, lastAnalyzed: '2024-01-01' } })
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement([], ['src/modified.ts'], '/tmp/test-baseline.json');
    expect(result.overallStatus).toBe('BLOCK');
    expect(result.violations[0].reason).toContain('cannot increase warnings');
  });

  it('auto-initializes missing baseline entries for modified files', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{}');
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement([], ['src/modified.ts'], '/tmp/test-baseline.json');
    expect(mockWriteFile).toHaveBeenCalled();
    expect(result.overallStatus).toBe('PASS');
  });

  it('handles empty newFiles and modifiedFiles arrays', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await runEnforcement([], [], '/tmp/test-baseline.json');
    expect(result.overallStatus).toBe('PASS');
    expect(result.summary.totalFiles).toBe(0);
  });

  it('filters out empty strings from file arrays', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await runEnforcement(['', '  ', ''], ['', '  '], '/tmp/test.json');
    expect(result.overallStatus).toBe('PASS');
  });

  it('auto-init saves updated baseline when missing entries exist', async () => {
    mockAnalyze.mockResolvedValue(
      fakeAnalysis([{ file: 'src/a.ts', line: 1, ruleId: 'test', severity: 'warning' as const, message: 'm' }])
    );
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({}));
    mockWriteFile.mockResolvedValue(undefined);

    await runEnforcement([], ['src/a.ts'], '/tmp/test-baseline.json');
    expect(mockWriteFile).toHaveBeenCalled();
    expect(vi.mocked(mockWriteFile).mock.calls[0][0]).toBe('/tmp/test-baseline.json');
  });

  // #452: the auto-init path inside runEnforcement once wrote only the current
  // commit's files, silently dropping entries for untouched files -- which then
  // made Gate 6 BLOCK files the commit never touched. The explicit
  // init-baseline command got merge semantics (#445); these tests pin the same
  // guarantee on the automatic path.
  it('REQ-452: auto-init preserves entries for files not in the current commit', async () => {
    // 6 warnings so the entry survives the "small baselines must clear" rule;
    // a clean file gains no entry by design (nothing to budget).
    const warnings = Array.from({ length: 6 }, (_, i) => ({
      file: 'plugins/dsh/src/command.ts', line: i + 1, ruleId: 'test', severity: 'warning' as const, message: 'm',
    }));
    mockAnalyze.mockResolvedValue(fakeAnalysis(warnings));
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'src/npm-package/lib/test-alignment.ts': { totalWarnings: 1, lastAnalyzed: '2024-01-01' } })
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement([], ['plugins/dsh/src/command.ts'], '/tmp/test-baseline.json');

    expect(result.overallStatus).toBe('PASS');
    expect(mockWriteFile).toHaveBeenCalled();
    const saved = JSON.parse(vi.mocked(mockWriteFile).mock.calls[0][1] as string) as Record<string, BaselineEntry>;
    expect(saved['src/npm-package/lib/test-alignment.ts']).toEqual({ totalWarnings: 1, lastAnalyzed: '2024-01-01' });
    expect(saved['plugins/dsh/src/command.ts']?.totalWarnings).toBe(6);
  });

  it('REQ-452: auto-init is idempotent -- a second run over the same files writes the same entries', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    const first = JSON.stringify({});

    mockReadFile.mockResolvedValue(first);
    await runEnforcement([], ['src/a.ts'], '/tmp/test-baseline.json');
    const savedOnce = vi.mocked(mockWriteFile).mock.calls.at(-1)![1] as string;

    mockReadFile.mockResolvedValue(savedOnce);
    mockWriteFile.mockClear();
    await runEnforcement([], ['src/a.ts'], '/tmp/test-baseline.json');
    const savedTwice = vi.mocked(mockWriteFile).mock.calls.at(-1)![1] as string;

    expect(JSON.parse(savedOnce)).toEqual(JSON.parse(savedTwice));
  });

  it('blocks modified file with <=5 baseline warnings that are not cleared', async () => {
    mockAnalyze.mockResolvedValue(
      fakeAnalysis([{ file: 'src/mod.ts', line: 1, ruleId: 'test', severity: 'warning' as const, message: 'm' }])
    );
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'src/mod.ts': { totalWarnings: 3, lastAnalyzed: '2024-01-01' } })
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement([], ['src/mod.ts'], '/tmp/test-baseline.json');
    expect(result.overallStatus).toBe('BLOCK');
    expect(result.violations[0].reason).toContain('must clear to zero');
  });

  it('enforcement passes when modified file clears all warnings', async () => {
    mockAnalyze.mockResolvedValue(emptyAnalysis());
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'src/mod.ts': { totalWarnings: 3, lastAnalyzed: '2024-01-01' } })
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await runEnforcement([], ['src/mod.ts'], '/tmp/test-baseline.json');
    expect(result.overallStatus).toBe('PASS');
  });
});

describe('calculateDelta reason messages', () => {
  it('returns "Warnings decreased" reason on decrease', () => {
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
    const result = calculateDelta({ totalWarnings: 8, lastAnalyzed: new Date().toISOString() } as BaselineEntry, 8, 'MODIFIED');
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

describe('classifyFiles edge cases', () => {
  it('ignores rename lines with insufficient parts', () => {
    const classified = classifyFiles(['R095']);
    expect(classified.renamed).toEqual([]);
  });

  it('ignores lines with less than 2 parts', () => {
    const classified = classifyFiles(['A']);
    expect(classified.new).toEqual([]);
  });

  it('handles unknown status codes gracefully', () => {
    const classified = classifyFiles(['X    src/unknown.ts']);
    expect(classified.new).toEqual([]);
    expect(classified.renamed).toEqual([]);
  });

  it('handles files with spaces in paths for new files', () => {
    const classified = classifyFiles(['A    src/my file.ts']);
    expect(classified.new).toEqual(['src/my file.ts']);
  });
});

describe('CLI integration', () => {
  const BOY_SCOUT_PATH = path.resolve(__dirname, '../boy-scout.ts');
  const CLI_TEST_TIMEOUT = 60000;

  it('shows help and exits with --help flag', async () => {
    const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} --help`, { timeout: 30000 });
    expect(stdout).toContain('Usage: boy-scout');
    expect(stdout).toContain('--new-files');
  }, CLI_TEST_TIMEOUT);

  it('shows help and exits with -h flag', async () => {
    const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} -h`, { timeout: 30000 });
    expect(stdout).toContain('Usage: boy-scout');
  }, CLI_TEST_TIMEOUT);

  it('shows help and exits with help command', async () => {
    const { stdout } = await execAsync(`npx tsx ${BOY_SCOUT_PATH} help`, { timeout: 30000 });
    expect(stdout).toContain('Usage: boy-scout');
  }, CLI_TEST_TIMEOUT);

  it('runs init-baseline via CLI against an isolated baseline', async () => {
    try {
      // Never point --baseline at the repo's tracked .warnings-baseline.json: this
      // test must not mutate tracked state. Use a throwaway path instead (#445).
      // NOTE: this file mocks 'fs/promises' (which also covers 'node:fs/promises'),
      // so use node:fs sync APIs -- they are not intercepted.
      const tmpBaseline = path.join(mkdtempSync(path.join(tmpdir(), 'bs-init-')), 'baseline.json');
      const { stdout } = await execAsync(
        `npx tsx ${BOY_SCOUT_PATH} --init-baseline src/principles/boy-scout.ts --baseline "${tmpBaseline}"`,
        { timeout: 30000 }
      );
      // The command now reports a merge summary instead of the old (misleading)
      // "Baseline initialized successfully" — it updates rather than replaces.
      expect(stdout).toContain('Baseline updated');
      expect(stdout).toContain(tmpBaseline);
      expect(typeof readFileSync(tmpBaseline, 'utf-8')).toBe('string');
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }, CLI_TEST_TIMEOUT);

  /**
   * @test REQ-DSH-014
   * @intent 验证 CLI 的 --init-baseline 是合并语义：既有条目不因初始化无关文件而丢失
   *         （#445 实测会把已跟踪基线摧毁成 {}）
   * @covers AC-DSH-014-01
   */
  it('init-baseline preserves pre-existing entries (merge, not replace)', async () => {
    try {
      const dir = mkdtempSync(path.join(tmpdir(), 'bs-merge-'));
      const tmpBaseline = path.join(dir, 'baseline.json');
      writeFileSync(
        tmpBaseline,
        JSON.stringify({
          'src/legacy.ts': { totalWarnings: 3, lastAnalyzed: '2026-01-01T00:00:00.000Z' },
        }),
        'utf-8'
      );

      await execAsync(
        `npx tsx ${BOY_SCOUT_PATH} --init-baseline src/principles/boy-scout.ts --baseline "${tmpBaseline}"`,
        { timeout: 30000 }
      );

      const written = JSON.parse(readFileSync(tmpBaseline, 'utf-8'));
      expect(written['src/legacy.ts']).toBeDefined();
      expect(written['src/legacy.ts'].totalWarnings).toBe(3);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }, CLI_TEST_TIMEOUT);

  it('runs enforcement via CLI with empty files', async () => {
    await expect(
      execAsync(`npx tsx ${BOY_SCOUT_PATH} --new-files "" --modified-files ""`, { timeout: 30000 })
    ).resolves.toMatchObject({ stdout: expect.stringContaining('"overallStatus"') });
  }, CLI_TEST_TIMEOUT);
});
