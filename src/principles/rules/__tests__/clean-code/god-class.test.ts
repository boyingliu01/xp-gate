import { describe, it, expect } from 'vitest';
import { godClassRule } from '../../clean-code/god-class';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('god-class.ts - God Class Rule', () => {
  it('should detect class with more than 15 methods', () => {
    const mockAdapterWithGodClass = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'GodClass',
        line: 1,
        code: `
class GodClass {
  method1() {}
  method2() {}
  method3() {}
  method4() {}
  method5() {}
  method6() {}
  method7() {}
  method8() {}
  method9() {}
  method10() {}
  method11() {}
  method12() {}
  method13() {}
  method14() {}
  method15() {}
  method16() {}
}
`
      }]
    };
    
    const violations = godClassRule.check('test.ts', mockAdapterWithGodClass as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.god-class');
    expect(violations[0].message).toContain('GodClass');
    expect(violations[0].message).toContain('16');
  });

  it('should pass for class with fewer than threshold methods', () => {
    const mockAdapterWithSmallClass = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'SmallClass',
        line: 1,
        code: `
class SmallClass {
  method1() {}
  method2() {}
  method3() {}
}
`
      }]
    };
    
    const violations = godClassRule.check('test.ts', mockAdapterWithSmallClass as any);
    
    expect(violations.length).toBe(0);
  });

  it('should exclude getters and setters from count', () => {
    const mockAdapterWithGetters = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'DataClass',
        line: 1,
        code: `
class DataClass {
  get name() { return this._name; }
  set name(value) { this._name = value; }
  get age() { return this._age; }
  set age(value) { this._age = value; }
  method1() {}
  method2() {}
  method3() {}
}
`
      }]
    };
    
    const violations = godClassRule.check('test.ts', mockAdapterWithGetters as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(godClassRule.threshold).toBe(15);
    expect(godClassRule.severity).toBe('warning');
  });
});