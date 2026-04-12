import { describe, it, expect } from 'vitest';
import { lspRule } from '../../solid/lsp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
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
    
    const violations = lspRule.check('test.ts', mockAdapterWithViolation as any);
    
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
    
    const violations = lspRule.check('test.ts', mockAdapterWithProperOverride as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use severity from config', () => {
    expect(lspRule.severity).toBe('info');
  });
});