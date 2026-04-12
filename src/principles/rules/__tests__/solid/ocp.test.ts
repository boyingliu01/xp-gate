import { describe, it, expect } from 'vitest';
import { ocpRule } from '../../solid/ocp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('ocp.ts - Open/Closed Principle Rule', () => {
  it('should detect possible base class modification', () => {
    const mockAdapterWithModification = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DerivedClass',
        line: 1,
        code: `
class BaseClass {
  method() {}
}
class DerivedClass extends BaseClass {
  method() {}
}
`
      }]
    };
    
    const violations = ocpRule.check('test.ts', mockAdapterWithModification as any);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.ocp');
  });

  it('should pass for proper extension', () => {
    const mockAdapterWithProperExtension = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DerivedClass',
        line: 1,
        code: `
class DerivedClass extends BaseClass {
  newMethod() {}
}
`
      }]
    };
    
    const violations = ocpRule.check('test.ts', mockAdapterWithProperExtension as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use severity from config', () => {
    expect(ocpRule.severity).toBe('info');
  });
});