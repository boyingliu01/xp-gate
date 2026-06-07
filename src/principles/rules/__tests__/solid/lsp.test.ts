import { describe, it, expect } from 'vitest';
import { lspRule } from '../../solid/lsp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('lsp.ts - Liskov Substitution Principle Rule', () => {
  it('should detect parameter type changes in override', () => {
    const mockAdapterWithViolation = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DerivedRepo',
        line: 1,
        code: `class DerivedRepo extends BaseRepo { findById(id: UserId): Entity {} }`
      }]
    };
    
    const violations = lspRule.check('test.ts', mockAdapterWithViolation as never);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.lsp');
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

  it('should return empty violations when adapter throws error', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractClasses: () => { throw new Error('Adapter failed'); }
    };
    
    const violations = lspRule.check('test.ts', mockAdapterThatThrows as never);
    
    expect(violations.length).toBe(0);
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

  it('reports violation with className undefined (className && ... false branch)', () => {
    // cls.name undefined → className && ... short-circuits to false → incompatible
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        line: 1,
        code: `class X extends B { foo(id: CustomId) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.lsp');
  });

  it('falls back to line 0 when cls.line is missing', () => {
    const adapter = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'D',
        // no line
        code: `class D extends B { foo(id: CustomId) {} }`,
      }],
    };
    const violations = lspRule.check('test.ts', adapter as never);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(0);
  });
});