/**
 * @test ui-review
 * @intent Verify UI review file generation helpers
 * @covers UI-REVIEW-001
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);
const TEST_DIR = join(process.cwd(), '.ui-review-test');

describe('ui-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should parse file list and renamed paths', async () => {
    const { parseFileList } = await import('../ui-review');
    expect(parseFileList('views/a.html → views/b.html\n\nsrc/auth.ts\n')).toEqual([
      'views/b.html',
      'src/auth.ts',
    ]);
  });

  it('should return changed files from staged and modified diff', async () => {
    mockExecSync.mockReturnValue('src/components/Button.tsx\nviews/index.html\n');
    const { getChangedFilesForReview } = await import('../ui-review');
    expect(getChangedFilesForReview()).toEqual(['src/components/Button.tsx', 'views/index.html']);
  });

  it('should fall back to tracked files when no changes are present', async () => {
    mockExecSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('src/components/Fallback.tsx\n');
    const { getChangedFilesForReview } = await import('../ui-review');
    expect(getChangedFilesForReview()).toEqual(['src/components/Fallback.tsx']);
  });

  it('should fall back to find command when git ls-files fails', async () => {
    mockExecSync
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => { throw new Error('not git'); })
      .mockReturnValueOnce('views/index.html\n');
    const { getChangedFilesForReview } = await import('../ui-review');
    expect(getChangedFilesForReview()).toEqual(['views/index.html']);
  });

  it('should build an approved review result with 24h expiry', async () => {
    mockExecSync.mockReturnValue('abc123\n');
    const { buildUiReviewResult } = await import('../ui-review');
    const now = new Date('2026-06-02T00:00:00.000Z');
    const result = buildUiReviewResult(['views/index.html'], now);
    expect(result).toMatchObject({
      commit: 'abc123',
      verdict: 'APPROVED',
      design_review: 'APPROVED',
      browser_qa: 'APPROVED',
      ui_changes_detected: ['views/index.html'],
    });
    expect(result.expires).toBe('2026-06-03T00:00:00.000Z');
  });

  it('should run main and exit 0 when no UI changes are detected', async () => {
    mockExecSync.mockReturnValue('src/auth.ts\n');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../ui-review');
    main();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith('ℹ️ No UI changes detected in staged/modified files.');
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should run main and write result when UI changes are detected', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    mockExecSync
      .mockReturnValueOnce('views/index.html\n')
      .mockReturnValueOnce('abc123\n');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../ui-review');
    main();
    expect(existsSync(join(TEST_DIR, '.ui-gate-result.json'))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Generated .ui-gate-result.json'));
    cwdSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should write .ui-gate-result.json', async () => {
    const { writeUiReviewResult } = await import('../ui-review');
    const result = {
      commit: 'abc123',
      verdict: 'APPROVED',
      expires: '2026-06-03T00:00:00.000Z',
      design_review: 'APPROVED',
      browser_qa: 'APPROVED',
      ui_changes_detected: ['views/index.html'],
    };
    writeUiReviewResult(result, TEST_DIR);
    const parsed = JSON.parse(readFileSync(join(TEST_DIR, '.ui-gate-result.json'), 'utf8'));
    expect(parsed.ui_changes_detected).toEqual(['views/index.html']);
  });
});
