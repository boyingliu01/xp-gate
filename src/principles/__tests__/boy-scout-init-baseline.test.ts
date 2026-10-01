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

import { writeFile, readFile } from 'fs/promises';
import { initBaselineCommand } from '../boy-scout';
import { analyze } from '../analyzer';

const mockAnalyze = vi.mocked(analyze);
const mockWriteFile = vi.mocked(writeFile);
const mockReadFile = vi.mocked(readFile);

function violationsFor(counts: Record<string, number>) {
  const violations = [];
  for (const [file, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      violations.push({
        file,
        line: i + 1,
        ruleId: 'clean-code.magic-numbers',
        message: 'm',
        severity: 'warning' as const,
      });
    }
  }
  return { violations, summary: {}, fileResults: {}, ruleResults: {}, executionTimeMs: 0, errors: [] };
}

/**
 * @test REQ-DSH-014
 * @intent 验证 `--init-baseline` 是**合并**语义而非覆盖：既有基线条目必须保留，
 *         且写入路径必须尊重 `--baseline` 参数，不得硬编码 .warnings-baseline.json
 *         （#445 —— 实测该命令会把已跟踪的基线摧毁成 {}）
 * @covers AC-DSH-014-01
 */
describe('initBaselineCommand must not destroy existing baselines (#445)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('merges into the existing baseline instead of replacing it', async () => {
    // Existing tracked baseline already has an entry for an unrelated file.
    const existing = {
      'src/legacy.ts': { totalWarnings: 3, lastAnalyzed: '2026-01-01T00:00:00.000Z' },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing) as never);
    mockAnalyze.mockResolvedValue(violationsFor({ 'src/new.ts': 2 }) as never);

    await initBaselineCommand(['src/new.ts'], '.warnings-baseline.json');

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, writtenRaw] = mockWriteFile.mock.calls[0];
    const written = JSON.parse(String(writtenRaw));

    // The pre-existing entry MUST survive.
    expect(written['src/legacy.ts']).toBeDefined();
    expect(written['src/legacy.ts'].totalWarnings).toBe(3);
    // And the newly analysed file must be added.
    expect(written['src/new.ts']).toBeDefined();
    expect(written['src/new.ts'].totalWarnings).toBe(2);
  });

  it('writes to the path given by --baseline, not the hardcoded default', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT') as never);
    mockAnalyze.mockResolvedValue(violationsFor({ 'src/a.ts': 1 }) as never);

    await initBaselineCommand(['src/a.ts'], 'custom/baseline.json');

    const [targetPath] = mockWriteFile.mock.calls[0];
    expect(String(targetPath)).toBe('custom/baseline.json');
    expect(String(targetPath)).not.toBe('.warnings-baseline.json');
  });

  it('does not persist an empty object when analysis yields no warnings', async () => {
    const existing = {
      'src/legacy.ts': { totalWarnings: 1, lastAnalyzed: '2026-01-01T00:00:00.000Z' },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing) as never);
    // File now has zero warnings.
    mockAnalyze.mockResolvedValue(violationsFor({}) as never);

    await initBaselineCommand(['src/clean.ts'], '.warnings-baseline.json');

    const [, writtenRaw] = mockWriteFile.mock.calls[0];
    const written = JSON.parse(String(writtenRaw));
    // Must NOT be {} -- the legacy entry has to survive.
    expect(Object.keys(written)).toContain('src/legacy.ts');
  });

  it('reports which entries were added and which were preserved', async () => {
    const existing = {
      'src/legacy.ts': { totalWarnings: 3, lastAnalyzed: '2026-01-01T00:00:00.000Z' },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing) as never);
    mockAnalyze.mockResolvedValue(violationsFor({ 'src/new.ts': 1 }) as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await initBaselineCommand(['src/new.ts'], '.warnings-baseline.json');

    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toMatch(/src\/legacy\.ts/);
    expect(output).toMatch(/src\/new\.ts/);
    log.mockRestore();
  });

  it('signals outcome via its return value, never process.exitCode', async () => {
    // Delphi Round 1: three experts independently flagged that this command
    // reported failure by mutating global exit state, so an unrelated
    // non-zero process.exitCode would be misread as this command failing.
    mockReadFile.mockRejectedValue(new Error('ENOENT') as never);
    mockAnalyze.mockResolvedValue(violationsFor({ 'src/a.ts': 1 }) as never);
    const previousExitCode = process.exitCode;
    process.exitCode = 0;

    const result = await initBaselineCommand(['src/a.ts'], '.warnings-baseline.json');

    expect(result.ok).toBe(true);
    // Global state must be untouched by the command.
    expect(process.exitCode).toBe(0);

    process.exitCode = previousExitCode;
  });

  it('can never empty a non-empty baseline, even when analysis finds nothing', async () => {
    // The merge starts from the existing entries, so the destructive overwrite
    // from #445 is structurally impossible rather than merely guarded.
    const existing = {
      'src/legacy.ts': { totalWarnings: 1, lastAnalyzed: '2026-01-01T00:00:00.000Z' },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing) as never);
    mockAnalyze.mockResolvedValue(violationsFor({}) as never);

    const result = await initBaselineCommand(['src/clean.ts'], '.warnings-baseline.json');

    expect(result.ok).toBe(true);
    const [, writtenRaw] = mockWriteFile.mock.calls[0];
    const written = JSON.parse(String(writtenRaw));
    expect(Object.keys(written)).toContain('src/legacy.ts');
  });
});
