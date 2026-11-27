import { describe, it, expect } from 'vitest';
import { godClassRule } from '../../clean-code/god-class';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
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
    
    const violations = godClassRule.check('test.ts', mockAdapterWithGodClass as never);
    
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
    
    const violations = godClassRule.check('test.ts', mockAdapterWithSmallClass as never);
    
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
    
    const violations = godClassRule.check('test.ts', mockAdapterWithGetters as never);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(godClassRule.threshold).toBe(15);
    expect(godClassRule.severity).toBe('warning');
  });

  it('should propagate adapter errors (no empty catch, #392)', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractClasses: () => { throw new Error('Adapter failed'); }
    };
    
    expect(() => godClassRule.check('test.ts', mockAdapterThatThrows as never)).toThrow('Adapter failed');
  });

  it('reports nothing when the adapter cannot list classes', () => {
    // `extractClasses` is OPTIONAL: an adapter may not implement it at all, and the rule
    // must read that as "no classes", not throw.
    const bare = { detectLanguage: () => 'java', extractFunctions: () => [] };
    expect(godClassRule.check('test.java', bare as never)).toHaveLength(0);
  });

  it('skips a class whose source the adapter did not provide', () => {
    // Without a body there is nothing to count, and guessing from an empty string would
    // report a zero-method class as fine -- a confident false negative.
    const noSource = {
      ...mockAdapter,
      extractClasses: () => [{ name: 'Empty', line: 1 }],
    };
    expect(godClassRule.check('test.ts', noSource as never)).toHaveLength(0);
  });
});
