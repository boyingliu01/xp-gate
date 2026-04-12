import { describe, it, expect } from 'vitest';
import { deepNestingRule } from '../../clean-code/deep-nesting';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('deep-nesting.ts - Deep Nesting Rule', () => {
  it('should detect function with nesting deeper than 4 levels', () => {
    const mockAdapterWithDeepNesting = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'deeplyNested',
        startLine: 1,
        code: `
function deeplyNested() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return true;
          }
        }
      }
    }
  }
}
`,
        nestingDepth: 5
      }]
    };
    
    const violations = deepNestingRule.check('test.ts', mockAdapterWithDeepNesting as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.deep-nesting');
  });

  it('should pass for function with acceptable nesting', () => {
    const mockAdapterWithNormalNesting = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'normalNesting',
        startLine: 1,
        nestingDepth: 3
      }]
    };
    
    const violations = deepNestingRule.check('test.ts', mockAdapterWithNormalNesting as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(deepNestingRule.threshold).toBe(4);
    expect(deepNestingRule.severity).toBe('warning');
  });
});