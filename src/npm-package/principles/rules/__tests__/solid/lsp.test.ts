import { describe, it, expect } from 'vitest';
import { lspRule, buildViolation } from '../../solid/lsp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('lsp.ts - Liskov Substitution Principle Rule', () => {
  it('stays silent on a parameter type it cannot resolve against the base contract', () => {
    // #588 changed what this rule is allowed to claim. `UserId` is neither a primitive nor
    // a prefix of the class name, so a single-file analysis has no way to know what the
    // BASE class declares — and "cannot determine" must not be reported as a violation.
    // The previous expectation here asserted the defect: it read an unknown type as proof
    // of incompatibility, which on Java flagged every class that has `extends`.
    const mockAdapterWithViolation = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DerivedRepo',
        line: 1,
        code: `class DerivedRepo extends BaseRepo { findById(id: UserId): Entity {} }`
      }]
    };

    const violations = lspRule.check('test.ts', mockAdapterWithViolation as never);

    expect(violations).toHaveLength(0);
  });

  it('should pass for proper override', () => {
    const mockAdapterWithProperOverride = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DerivedRepo',
        line: 1,
        code: `
class DerivedRepo extends BaseRepo {
  findById(id: string): Entity | null {}
}
`
      }]
    };
    
    const violations = lspRule.check('test.ts', mockAdapterWithProperOverride as never);
    
    expect(violations.length).toBe(0);
  });

  it('should use severity from config', () => {
    expect(lspRule.severity).toBe('info');
  });

  it('should propagate adapter errors (no empty catch, #392)', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractClasses: () => { throw new Error('Adapter failed'); }
    };
    
    expect(() => lspRule.check('test.ts', mockAdapterThatThrows as never)).toThrow('Adapter failed');
  });

  /**
   * @test REQ-174 Branch coverage for lsp rule
   * @intent Cover uncovered branches: missing class.code, no extends keyword,
   *         non-class extractClasses returning null, params without ':',
   *         params with ':' but no type word, cls.line missing fallback,
   *         className startsWith paramType branch.
   * @covers AC-174-05, AC-174-06, AC-174-07
   */
  it('returns no violations when extractClasses returns null (|| [] branch)', () => {
    const adapter = {
      ...mockAdapter,
      extractClasses: () => null as unknown as never[],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when class has no code property', () => {
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{ name: 'X', line: 1 }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when class does not extend anything', () => {
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'Plain',
        line: 1,
        code: `class Plain { method(id: Foo) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('ignores params with no type annotation (no colon branch)', () => {
    // foo(id) — no colon → extractParamType returns null
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'D',
        line: 1,
        code: `class D extends B { foo(id) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('ignores params with colon but no matchable type word', () => {
    // foo(id: ) — colon present but typeMatch fails → returns null
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'D',
        line: 1,
        code: `class D extends B { foo(id: ) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('treats primitive parameter types as compatible', () => {
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'D',
        line: 1,
        code: `class D extends B { foo(s: string, n: number, b: boolean, a: any, v: void, x: Object) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('treats parameter types that start with className as compatible', () => {
    // className = 'User', paramType = 'UserId' (startsWith match)
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'User',
        line: 1,
        code: `class User extends Base { findById(id: UserId) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('stays silent even when the class name is missing (no name is not evidence)', () => {
    // This used to report, on the reasoning that `className && ...` short-circuits to
    // false. Under #588 that is precisely the defect: an ABSENT name is one more thing the
    // analysis does not know, so it cannot justify a verdict.
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        line: 1,
        code: `class X extends B { foo(id: CustomId) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations).toHaveLength(0);
  });

  it('falls back to line 0 when a violation is built for a class with no line', () => {
    // Asserted on the builder directly. After #588 `lspRule.check` can no longer reach
    // this code path for an unknown type — that is the fix — so a case going through
    // `check` would pass without exercising the `?? 0` fallback at all. A control that
    // cannot fail proves nothing, which is why the import is explicit.
    const violation = buildViolation('test.ts', { name: 'D' }, 'CustomId');
    expect(violation.line).toBe(0);
    expect(violation.ruleId).toBe('solid.lsp');
    // And the line is honoured when present, so the fallback is not always taken.
    const withLine = buildViolation('test.ts', { name: 'D', line: 42 }, 'CustomId');
    expect(withLine.line).toBe(42);
  });
});