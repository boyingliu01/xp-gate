/**
 * Tests for src/gates/pbt-detect.ts — Property-Based Testing Detection.
 * @test REQ-337
 * @intent Verify PBT framework detection, file scanning,
 *         coverage calculation, and report generation.
 * @covers AC-337-1 (PBT detection provides visibility into property-based testing usage)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

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

/**
 * Three test files, exactly one of which uses fast-check.
 *
 * Named so the statistics asserted below are derived from the fixture instead of
 * restated as magic numbers (Gate 4 flags both the bare 3 and the bare 33).
 */
/**
 * Install a readdir mock describing exactly one project layout.
 *
 * Every case in this file needs the same three answers -- what `src/` holds, what
 * `src/__tests__/` holds, and empty for everything else -- and writing that
 * scaffold out per test was the bulk of the file's duplicate-code score (29.9% at
 * the 15% threshold, flagged by Gate 4). `srcEntries` and `testEntries` are all a
 * case has to state.
 *
 * #857 makes the scanner consult several roots (src/, tests/, test/,
 * __tests__/, lib/), so every comparison is anchored to the fixture root; a
 * suffix test would let several roots answer with the same fixture and inflate
 * the count.
 */
function mockReaddirForLayout(
  srcEntries: Array<{ name: string; isDirectory: () => boolean }>,
  testEntries: Array<{ name: string; isDirectory: () => boolean }>,
): void {
  mockReaddirSync.mockImplementation(((dir: unknown) => {
    const dirStr = String(dir);
    if (dirStr === path.join('/fake/project', 'src')) return srcEntries as never;
    if (dirStr === path.join('/fake/project', 'src', '__tests__')) return testEntries as never;
    return [] as never;
  }) as never);
}

const PBT_FIXTURE_FILES = [
  { name: 'a.test.ts', isDirectory: () => false },
  { name: 'b.test.ts', isDirectory: () => false },
  { name: 'c.spec.ts', isDirectory: () => false },
];

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
    mockReaddirForLayout(
      [
          { name: '__tests__', isDirectory: () => true },
      ],
      [
          { name: 'app.test.ts', isDirectory: () => false },
      ],
    );


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
    mockReaddirForLayout(
      [
          { name: '__tests__', isDirectory: () => true },
      ],
      [
          { name: 'prop.test.ts', isDirectory: () => false },
      ],
    );


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
    mockReaddirForLayout(
      [
        { name: '__tests__', isDirectory: () => true },
      ],
      [
        { name: 'app.test.ts', isDirectory: () => false },
        { name: 'util.test.ts', isDirectory: () => false },
      ],
    );

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
      // Anchored to the fixture root: #857 makes detectPBT scan
      // src/, tests/, test/, __tests__/ and lib/, so a suffix test would let
      // several roots answer with the same fixture.
      if (dirStr === path.join('/fake/project', 'src')) {
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
      // Anchored to the fixture root: #857 makes detectPBT scan
      // src/, tests/, test/, __tests__/ and lib/, so a suffix test would let
      // several roots answer with the same fixture.
      if (dirStr === path.join('/fake/project', 'src')) {
        return [
          { name: '__tests__', isDirectory: () => true },
        ] as any;
      }
      if (dirStr === path.join('/fake/project', 'src', '__tests__')) {
        return PBT_FIXTURE_FILES as any;
      }
      return [] as any;
    });
    // First file has PBT, others don't
    mockReadFileSync
      .mockReturnValueOnce("import fc from 'fast-check'; fc.assert(fc.property(fc.integer(), n => n >= 0));")
      .mockReturnValueOnce('test("b", () => {});')
      .mockReturnValueOnce('test("c", () => {});');

    // Derived from the fixture rather than restated: three files, one of which
    // uses fast-check, so the coverage is 1/3 rounded. Hardcoding 3 and 33 put two
    // magic numbers here that had to be kept in step with the list above by hand.
    const report = detectPBT('/fake/project');
    expect(report.testFiles.length).toBe(PBT_FIXTURE_FILES.length);
    expect(report.pbtTestFiles.length).toBe(1);
    expect(report.coverage).toBe(Math.round((1 / PBT_FIXTURE_FILES.length) * 100));
    expect(report.messages.some(m => m.includes('Property-Based Testing Report'))).toBe(true);
  });
});

/**
 * @test REQ-PBT-857 the PBT scanner must see .mjs/.cjs/.mts/.cts test files
 * @intent #857 measured on a real `node --test` project with 14 files named
 *         `tests/*.test.mjs`:
 *
 *           $ xp-gate check --gates pbt .
 *           Test files:    0
 *           PBT files:     0 (0%)
 *             No test files found.
 *
 *         Two separate causes, both pinned below:
 *
 *         1. TEST_SUFFIXES was `['.test.ts', '.test.js', '.spec.ts', '.spec.js']`
 *            — .mjs/.cjs/.mts/.cts were invisible. Those are what Node tooling
 *            ships by default now, and `node --test` is built in, so this is not
 *            an exotic layout. Same root cause as #732, different code path.
 *
 *         2. Only `src/` was scanned. A project laying tests out in `tests/`
 *            reported zero files even with a perfectly ordinary `.test.js`. The
 *            issue's fixture used `tests/`, so fixing only the suffixes would
 *            still have produced 0.
 *
 *         The damage is not a missing statistic: a reported "0%" is read as "this
 *         project has no property tests", when the truth is "the scanner did not
 *         look". A measurement that failed must not be rendered as a measurement.
 *
 * @covers AC-857-01 the four ESM/CJS suffixes are recognised as test files
 * @covers AC-857-02 a tests/ directory is scanned, not just src/
 * @covers AC-857-03 "found no files" is not rendered as a 0% measurement
 */
describe('#857 PBT must see .mjs/.cjs test files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue('' as never);
  });

  it('AC-857-01: recognises .test.mjs, .test.cjs, .test.mts and .test.cts', () => {
    mockExistsSync.mockReturnValue(true as never);
    const moduleTestFiles = [
      { name: 'alpha.test.mjs', isDirectory: () => false },
      { name: 'beta.test.cjs', isDirectory: () => false },
      { name: 'gamma.test.mts', isDirectory: () => false },
      { name: 'delta.test.cts', isDirectory: () => false },
    ];
    mockReaddirSync.mockImplementation(((dir: string) => {
      // Only the src/ root holds fixtures; leaving the other roots empty keeps
      // each file counted exactly once.
      if (String(dir) !== path.join('/fake/project', 'src')) return [] as never;
      return moduleTestFiles as never;
    }) as never);

    const report = detectPBT('/fake/project');
    expect(report.testFiles.length).toBe(moduleTestFiles.length);
  });

  it('AC-857-02: scans a top-level tests/ directory, not only src/', () => {
    // src/ exists but is empty; the real tests live in tests/.
    mockExistsSync.mockReturnValue(true as never);
    mockReaddirSync.mockImplementation(((dir: string) => {
      if (String(dir).endsWith('src')) return [] as never;
      if (String(dir).endsWith('tests')) {
        return [{ name: 'units.test.mjs', isDirectory: () => false }] as never;
      }
      return [] as never;
    }) as never);

    const report = detectPBT('/fake/project');
    expect(report.testFiles.length).toBe(1);
  });

  it('AC-857-03: reporting no files does not print a 0% coverage figure', () => {
    // The conflation #857 names: "0%" is a measurement, and when nothing was
    // scanned there is no measurement to report. Say "not checked", not zero.
    mockExistsSync.mockReturnValue(true as never);
    mockReaddirSync.mockReturnValue([] as never);

    const report = detectPBT('/fake/project');
    expect(report.testFiles.length).toBe(0);
    const joined = report.messages.join('\n');
    expect(joined).toContain('No test files found');
    // A bare "0%" beside no files is the misleading rendering this pins.
    expect(joined).not.toMatch(/PBT files:\s+0 \(0%\)/);
  });
});
