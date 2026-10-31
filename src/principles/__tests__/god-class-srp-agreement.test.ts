/**
 * @test REQ-678
 * @intent `solid.srp` and `clean-code.god-class` describe the same fact -- "this
 *         class has too many methods" -- with the same threshold. On
 *         `TypeScriptAdapter` (66 methods) srp reported it and god-class stayed
 *         silent, because god-class re-derived the count from source text with a
 *         regex that cannot see a signature spread over several lines. Two rules,
 *         one class, opposite verdicts: whichever one was wrong was invisible.
 *
 *         When the adapter has already parsed the class structurally its
 *         `methodCount` is the answer; the regex is a fallback for the adapters
 *         that do not (Java, C++, Objective-C).
 * @covers AC-678-01, AC-678-02
 */
import { describe, it, expect } from 'vitest';
import { godClassRule } from '../rules/clean-code/god-class';
import type { Adapter } from '../types';

/** Minimal adapter stub exposing only what the rule consumes. */
function adapterWithClass(cls: { name: string; line: number; code?: string; methodCount?: number }): Adapter {
  return { extractClasses: () => [cls] } as unknown as Adapter;
}

describe('clean-code.god-class agrees with solid.srp (REQ-678)', () => {
  it('AC-678-01: an adapter-reported methodCount over the threshold is flagged', () => {
    // A signature spread over lines: the regex fallback counts zero of these.
    const code = [
      'class BigAdapter {',
      '  methodOne(',
      '    a: number,',
      '  ): void { }',
      '}',
    ].join('\n');

    const violations = godClassRule.check('src/BigAdapter.ts', adapterWithClass({
      name: 'BigAdapter',
      line: 1,
      code,
      methodCount: 66,
    }));

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('66');
  });

  it('AC-678-01: a small adapter-reported count is not flagged', () => {
    const violations = godClassRule.check('src/Small.ts', adapterWithClass({
      name: 'Small',
      line: 1,
      code: 'class Small { a(): void {} }',
      methodCount: 3,
    }));
    expect(violations).toHaveLength(0);
  });

  it('AC-678-02: without a reported count the regex fallback still works (anti-vacuity)', () => {
    // Java-shaped source with no methodCount -- the fallback must still fire,
    // otherwise this change would have disabled the rule for those adapters.
    // 16 methods: over the shipped threshold of 15.
    const methods = Array.from({ length: 16 }, (_, i) => `  public void m${i}() { }`).join('\n');
    const code = [
      'public class Fat {',
      methods,
      '}',
    ].join('\n');

    const violations = godClassRule.check('src/Fat.java', adapterWithClass({
      name: 'Fat',
      line: 1,
      code,
    }));

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('16');
  });
});
