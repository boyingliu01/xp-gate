import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config', () => ({
  getDefaultConfig: () => ({
    rules: {
      'clean-code': {
        'many-exports': {
          enabled: true,
          // threshold intentionally omitted -> exercises ?? 10 fallback branch
          severity: 'warning',
        },
      },
    },
  }),
}));

import { manyExportsRule } from '../../clean-code/many-exports';

/**
 * @test REQ-174 Branch coverage for many-exports rule
 * @intent Cover every branch in many-exports.ts (extractExports presence,
 *         threshold boundary, empty/undefined exports, first-export line fallback,
 *         and try/catch fallback) so branch coverage reaches >=80%.
 * @covers AC-174-01, AC-174-02, AC-174-03, AC-174-04
 */

const baseAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0,
};

describe('manyExportsRule', () => {
  it('has correct rule metadata', () => {
    expect(manyExportsRule.id).toBe('clean-code.many-exports');
    expect(manyExportsRule.name).toBe('Many Exports Rule');
    expect(manyExportsRule.threshold).toBe(10);
    expect(manyExportsRule.severity).toBe('warning');
  });

  it('returns no violations when adapter lacks extractExports (falsy branch)', () => {
    // typedAdapter.extractExports is undefined -> exports = []
    const violations = manyExportsRule.check('file.ts', baseAdapter as never);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when extractExports returns empty array', () => {
    const adapter: never = {
      ...baseAdapter,
      extractExports: () => [],
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when export count equals threshold (boundary)', () => {
    const adapter: never = {
      ...baseAdapter,
      extractExports: () =>
        Array.from({ length: 10 }, (_, i) => ({ line: i + 1 })),
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(0);
  });

  it('returns violation when export count exceeds threshold', () => {
    const adapter: never = {
      ...baseAdapter,
      extractExports: () =>
        Array.from({ length: 11 }, (_, i) => ({ line: i + 5 })),
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: 'file.ts',
      line: 5,
      ruleId: 'clean-code.many-exports',
      message:
        'Module has too many exports: 11 (maximum: 10). Consider splitting into focused sub-modules.',
      severity: 'warning',
    });
  });

  it('falls back to line 1 when first export line is missing/zero', () => {
    const adapter: never = {
      ...baseAdapter,
      // first export has line 0 -> `exports[0]?.line || 1` selects 1
      extractExports: () =>
        Array.from({ length: 11 }, () => ({ line: 0 })),
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
  });

  it('returns empty violations when extractExports returns undefined', () => {
    // covers the `exports && ...` short-circuit false branch
    const adapter: never = {
      ...baseAdapter,
      extractExports: () => undefined,
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(0);
  });

  it('returns empty violations when adapter throws (catch branch)', () => {
    const adapter: never = {
      ...baseAdapter,
      extractExports: () => {
        throw new Error('boom');
      },
    } as never;
    const violations = manyExportsRule.check('file.ts', adapter);
    expect(violations).toHaveLength(0);
  });
});
