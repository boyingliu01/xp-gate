/**
 * Tests for src/gates/pbt-detect.ts — Property-Based Testing Detection.
 * @test REQ-337
 * @intent Verify PBT framework detection, file scanning,
 *         coverage calculation, and report generation.
 * @covers AC-337-1 (PBT detection provides visibility into property-based testing usage)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn() },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { detectPBT } from '../pbt-detect';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe('pbt-detect.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty report when src/ does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const report = detectPBT('/fake/project');
    expect(report.detected).toBe(false);
    expect(report.frameworks).toEqual([]);
    expect(report.testFiles).toEqual([]);
    expect(report.pbtTestFiles).toEqual([]);
    expect(report.coverage).toBe(0);
    expect(report.messages.some(m => m.includes('No test files found'))).toBe(true);
  });

  it('detects fast-check import in test files', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
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
    mockReadFileSync.mockReturnValue(`
      import fc from 'fast-check';
      test('property test', () => {
        fc.assert(fc.property(fc.integer(), n => n === n));
      });
    `);

    const report = detectPBT('/fake/project');
    expect(report.detected).toBe(true);
    expect(report.frameworks).toContain('fast-check');
    expect(report.pbtTestFiles.length).toBe(1);
    expect(report.coverage).toBe(100);
  });

  it('detects PBT API usage without explicit import', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (dirStr.endsWith('__tests__')) {
        return [
          { name: 'prop.test.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });
    mockReadFileSync.mockReturnValue(`
      // Some test using fc.property directly
      fc.property(fc.array(fc.integer()), arr => {
        expect(arr.reverse().reverse()).toEqual(arr);
      });
    `);

    const report = detectPBT('/fake/project');
    expect(report.detected).toBe(true);
    expect(report.frameworks).toContain('unknown-pbt');
  });

  it('reports no PBT when test files exist but none use PBT', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (dirStr.endsWith('__tests__')) {
        return [
          { name: 'app.test.ts', isDirectory: () => false },
          { name: 'util.test.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });
    mockReadFileSync.mockReturnValue(`
      test('regular test', () => {
        expect(1 + 1).toBe(2);
      });
    `);

    const report = detectPBT('/fake/project');
    expect(report.detected).toBe(false);
    expect(report.pbtTestFiles).toEqual([]);
    expect(report.coverage).toBe(0);
    expect(report.testFiles.length).toBe(2);
    expect(report.messages.some(m => m.includes('No property-based testing detected'))).toBe(true);
  });

  it('skips node_modules and .git directories', () => {
    mockExistsSync.mockReturnValue(true);
    const scannedDirs: string[] = [];
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      scannedDirs.push(dirStr);
      if (dirStr.endsWith('src')) {
        return [
          { name: 'node_modules', isDirectory: () => true },
          { name: '.git', isDirectory: () => true },
          { name: 'app.test.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });
    mockReadFileSync.mockReturnValue('test("x", () => {});');

    detectPBT('/fake/project');
    // Should not scan into node_modules or .git
    expect(scannedDirs.some(d => d.includes('node_modules'))).toBe(false);
    expect(scannedDirs.some(d => d.includes('.git') && !d.endsWith('src'))).toBe(false);
  });

  it('generates report with correct statistics', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr.endsWith('src')) {
        return [
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (dirStr.endsWith('__tests__')) {
        return [
          { name: 'a.test.ts', isDirectory: () => false },
          { name: 'b.test.ts', isDirectory: () => false },
          { name: 'c.spec.ts', isDirectory: () => false },
        ] as any;
      }
      return [] as any;
    });
    // First file has PBT, others don't
    mockReadFileSync
      .mockReturnValueOnce("import fc from 'fast-check'; fc.assert(fc.property(fc.integer(), n => n >= 0));")
      .mockReturnValueOnce('test("b", () => {});')
      .mockReturnValueOnce('test("c", () => {});');

    const report = detectPBT('/fake/project');
    expect(report.testFiles.length).toBe(3);
    expect(report.pbtTestFiles.length).toBe(1);
    expect(report.coverage).toBe(33); // 1/3 = 33%
    expect(report.messages.some(m => m.includes('Property-Based Testing Report'))).toBe(true);
  });
});
