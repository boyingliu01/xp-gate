import { describe, it, expect } from 'vitest';
import { tooManyParamsRule } from '../../clean-code/too-many-params';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('too-many-params.ts - Too Many Parameters Rule', () => {
  it('should detect function with more than 7 parameters', () => {
    const mockAdapterWithManyParams = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'lotsOfParams',
        startLine: 1,
        params: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        paramCount: 8
      }]
    };
    
    const violations = tooManyParamsRule.check('test.ts', mockAdapterWithManyParams as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.too-many-params');
  });

  it('should pass for function with acceptable parameters', () => {
    const mockAdapterWithNormalParams = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'normalParams',
        startLine: 1,
        paramCount: 5
      }]
    };
    
    const violations = tooManyParamsRule.check('test.ts', mockAdapterWithNormalParams as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(tooManyParamsRule.threshold).toBe(7);
    expect(tooManyParamsRule.severity).toBe('info');
  });
});