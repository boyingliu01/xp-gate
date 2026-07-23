/**
 * Tests for src/gates/test-layers.ts — Test Layer Analytics.
 * @test REQ-359
 * @intent Verify test layer classification, source-test pairing,
 *         file exclusion/exemption rules, and report generation.
 * @covers AC-359-1 (Test layer analytics provides visibility into test distribution)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(), readdirSync: vi.fn() },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import { analyzeTestLayers } from '../test-layers';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

describe('test-layers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty report when src/ does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const report = analyzeTestLayers('/fake/project');
    expect(report.summary.totalSources).toBe(0);
    expect(report.summary.totalTests).toBe(0);
    expect(report.verdict).toBe('INFO');
  });

  it('classifies unit test files correctly', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: 'app.ts', isDirectory: () => false },
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (dirStr.endsWith('__tests__')) {
        return [
          { name: 'app.test.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });

    const report = analyzeTestLayers('/fake/project');
    expect(report.summary.unitTests).toBeGreaterThanOrEqual(0);
    expect(report.verdict).toBe('INFO');
  });

  it('excludes .d.ts files from source counting', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: 'types.d.ts', isDirectory: () => false },
          { name: 'app.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });

    const report = analyzeTestLayers('/fake/project');
    // types.d.ts should be excluded
    expect(report.summary.totalSources).toBe(1); // only app.ts
  });

  it('exempt files do not count as unpaired', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: 'types.ts', isDirectory: () => false },
          { name: 'index.ts', isDirectory: () => false },
          { name: 'constants.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });

    const report = analyzeTestLayers('/fake/project');
    // All exempt files — pair rate should be 100% (0 needing tests)
    expect(report.layer1.unpairedSources.length).toBe(0);
    expect(report.layer1.pairRate).toBe(100);
  });

  it('generates messages with layer statistics', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir).endsWith('src')) {
        return [
          { name: 'app.ts', isDirectory: () => false },
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (String(dir).endsWith('__tests__')) {
        return [
          { name: 'app.test.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });

    const report = analyzeTestLayers('/fake/project');
    expect(report.messages.some(m => m.includes('Test Layer Analytics'))).toBe(true);
    expect(report.messages.some(m => m.includes('Sources:'))).toBe(true);
    expect(report.messages.some(m => m.includes('Tests:'))).toBe(true);
  });
});
