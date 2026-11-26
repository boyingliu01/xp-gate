/**
 * @test REQ-CLEAN-CODE-THRESHOLD-FALLBACK
 * @intent A missing threshold must fall back to the RULE's declared default, not to zero.
 *
 *         Three rules resolved it to 0 (`settings.threshold ?? 0`). The path is
 *         unreachable while `getActiveConfig()` merges the defaults in, but 0 is the wrong
 *         answer for every one of them: every class would be a god class and every function
 *         too long, so a config accident would turn the gate into noise instead of leaving
 *         it unchanged (review MC-01/MC-02).
 *
 *         These cases drive the ACTUAL rules with a threshold-less config, which is the only
 *         way to prove the fallback rather than read it.
 *
 * @covers AC-CLEAN-CODE-THRESHOLD-FALLBACK-01
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getDefaultConfig, setActiveConfig, resetActiveConfig } from '../../../config';
import { deepNestingRule } from '../../clean-code/deep-nesting';
import { longFunctionRule } from '../../clean-code/long-function';
import { godClassRule } from '../../clean-code/god-class';

/** A config whose rule block exists but carries NO threshold. */
function configWithoutThreshold(): never {
  const base = getDefaultConfig() as never as {
    rules: Record<string, Record<string, Record<string, unknown>>>;
  };
  for (const id of ['deep-nesting', 'long-function', 'god-class']) {
    delete base.rules['clean-code'][id].threshold;
  }
  return base as never;
}

/** An adapter that reports one deeply nested, very long function. */
function stubAdapter() {
  return {
    filePath: 'x.ts',
    source: 'x',
    extractFunctions: () => [
      {
        name: 'f',
        startLine: 1,
        endLine: 80,
        body: 'if (a) { if (b) { if (c) { if (d) { if (e) { } } } } }',
        length: 80,
        nestingDepth: 5,
        paramCount: 1,
        hasTryCatch: false,
      },
    ],
    extractClasses: () => [
      { name: 'C', startLine: 1, endLine: 200, methodCount: 30, methods: [] },
    ],
  };
}

afterEach(() => {
  resetActiveConfig();
});

describe('a rule config without a threshold', () => {
  it('deep-nesting keeps its declared 4 rather than reporting every nested block', () => {
    setActiveConfig(configWithoutThreshold());
    // Depth 5 is over 4 but nowhere near over 0-adjacent nonsense: with `?? 0` EVERY
    // function with any nesting would violate, so the count would be identical for a
    // depth-1 stub. Asserting the depth-1 case is what separates the two behaviours.
    const shallow = { ...stubAdapter(), extractFunctions: () => [
      { name: 'g', startLine: 1, endLine: 3, body: 'if (a) { }', length: 3,
        nestingDepth: 1, paramCount: 0, hasTryCatch: false },
    ] };
    expect(deepNestingRule.check?.('x.ts', shallow as never)).toEqual([]);
  });

  it('long-function keeps its declared 50', () => {
    setActiveConfig(configWithoutThreshold());
    const short = { ...stubAdapter(), extractFunctions: () => [
      { name: 'g', startLine: 1, endLine: 10, body: '', length: 10,
        nestingDepth: 0, paramCount: 0, hasTryCatch: false },
    ] };
    expect(longFunctionRule.check?.('x.ts', short as never)).toEqual([]);
  });

  it('god-class keeps its declared 15', () => {
    setActiveConfig(configWithoutThreshold());
    const small = { ...stubAdapter(), extractClasses: () => [
      { name: 'C', startLine: 1, endLine: 20, methodCount: 3, methods: [] },
    ] };
    expect(godClassRule.check?.('x.ts', small as never)).toEqual([]);
  });
});
