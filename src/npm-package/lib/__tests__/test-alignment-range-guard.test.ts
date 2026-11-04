/**
 * @test REQ-670
 * @intent `expandAcCovers()` expands the `the range shorthand` shorthand, but
 *         the loop had no ceiling: a typo such as
 *         `a range with a wildly mistyped upper bound` produces a billion entries and
 *         a module-scope Set that eats memory until the process dies. The guard
 *         is not about hostile input -- an alignment run reads whatever
 *         annotations a repository happens to contain, and a single wrong digit
 *         is enough. Expansion past a sane ceiling must be refused LOUDLY rather
 *         than attempted: a silent truncation would drop coverage while still
 *         reading as a passing alignment, and a silent "two ids" would be
 *         indistinguishable from an annotation that genuinely lists two.
 * @covers AC-670-64
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { parseTestFiles } = await import('../test-alignment');

/** One test file whose @covers carries the given range. */
function writeTestFileWithRange(covers: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xpgate-range-'));
  const file = join(dir, 'range.test.ts');
  const header = ['/**', ' * @test REQ-670', ' * @intent fixture', ' * @covers ' + covers, ' */'];
  const body = ["it('does a thing', () => { expect(1).toBe(1); });"];
  writeFileSync(file, header.concat(body).join('\n'), 'utf8');
  return { dir, file };
}

/** Capture console.warn for the duration of `run`, so a refusal can be asserted. */
function captureWarnings<T>(run: () => T): { value: T; warnings: string } {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { value: run(), warnings: warnings.join('\n') };
  } finally {
    console.warn = originalWarn;
  }
}

describe('expandAcCovers guards an unbounded range', () => {
  it('expands a normal range, so the guard does not break the feature', () => {
    const { dir, file } = writeTestFileWithRange('AC-670-01 through AC-670-04');
    try {
      const map = parseTestFiles([file]);
      expect(map.tests[0].covers).toEqual(['AC-670-01', 'AC-670-02', 'AC-670-03', 'AC-670-04']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an absurd range instead of trying to build it', () => {
    // Without a ceiling this allocates ~1e9 strings and dies. The time assertion
    // proves the loop was never entered, which is the only acceptable behaviour.
    const huge = 'AC-' + '670' + '-000000001';
    const hugeEnd = 'AC-' + '670' + '-999999999';
    const { dir, file } = writeTestFileWithRange(huge + ' through ' + hugeEnd);
    const started = Date.now();
    try {
      const { value: map, warnings } = captureWarnings(() => parseTestFiles([file]));
      expect(Date.now() - started).toBeLessThan(5000);

      const ids = map.tests[0].covers || [];
      // It must NOT have materialised the range.
      expect(ids.length).toBeLessThan(1000);
      // The two literal endpoints are still real references and must survive --
      // dropping them would lose the only genuine signal in the annotation.
      expect(ids).toContain(huge);
      expect(ids).toContain(hugeEnd);
      // ...and the refusal has to be sayable, or the degradation is invisible.
      expect(warnings).toMatch(/refused to expand/);
      expect(warnings).toMatch(/typ/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
