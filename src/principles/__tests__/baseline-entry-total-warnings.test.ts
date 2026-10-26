/**
 * @test REQ-620
 * @intent Pin the single behavioural difference introduced when the two copies
 *         of the per-tool accumulator were merged into buildEntry:
 *         `createFromFiles` tested `totalWarnings` for TRUTHINESS, so a caller
 *         passing an explicit `0` had it replaced by the sum of the per-tool
 *         counts. That is exactly the case where the caller is overriding a
 *         stale per-tool number, so the override was silently discarded.
 *
 *         `initializeWithAnalyzer` already used `!== undefined`, so the two
 *         entry points disagreed about the same input. The merged version uses
 *         the `!== undefined` reading for both.
 * @covers AC-620-04
 */
import { describe, it, expect } from 'vitest';
import { BaselineStorage } from '../baseline';

function storage(): InstanceType<typeof BaselineStorage> {
  // Explicit config: a timeout far above any test's runtime.
  return new BaselineStorage({ maxSize: 100, timeoutMs: 10000, batchSize: 5 });
}

describe('AC-620-04: an explicit totalWarnings wins, including zero', () => {
  it('uses an explicit zero instead of the summed per-tool count', async () => {
    const baseline = await storage().createFromFiles([
      { file: 'a.ts', counts: { eslint: { warnings: 3, errors: 0 }, totalWarnings: 0 } },
    ]);
    expect(baseline['a.ts'].totalWarnings).toBe(0);
  });

  it('uses an explicit nonzero value instead of the summed count', async () => {
    const baseline = await storage().createFromFiles([
      { file: 'a.ts', counts: { eslint: { warnings: 3, errors: 0 }, totalWarnings: 42 } },
    ]);
    expect(baseline['a.ts'].totalWarnings).toBe(42);
  });

  it('sums the per-tool counts when no explicit total is given', async () => {
    const baseline = await storage().createFromFiles([
      {
        file: 'a.ts',
        counts: {
          eslint: { warnings: 3, errors: 0 },
          ruff: { warnings: 2, errors: 1 },
        },
      },
    ]);
    expect(baseline['a.ts'].totalWarnings).toBe(5);
  });

  it('keeps every per-tool count it was given', async () => {
    const baseline = await storage().createFromFiles([
      {
        file: 'a.ts',
        counts: {
          eslint: { warnings: 1, errors: 2 },
          ccn: { warnings: 3, max: 9 },
          shellcheck: { warnings: 4, errors: 5 },
        },
      },
    ]);
    const entry = baseline['a.ts'];
    expect(entry.eslint).toEqual({ warnings: 1, errors: 2 });
    expect(entry.ccn).toEqual({ warnings: 3, max: 9 });
    expect(entry.shellcheck).toEqual({ warnings: 4, errors: 5 });
    // Tools that were not supplied must not appear at all.
    expect(entry.ruff).toBeUndefined();
    expect(entry.golangci).toBeUndefined();
  });

  it('reports zero warnings for a file with no tool counts', async () => {
    const baseline = await storage().createFromFiles([{ file: 'a.ts', counts: {} }]);
    expect(baseline['a.ts'].totalWarnings).toBe(0);
    expect(baseline['a.ts'].lastAnalyzed).toBeTypeOf('string');
  });
});
