import { describe, it, expect } from 'vitest';
import { codeDuplicationRule } from '../../clean-code/code-duplication';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('code-duplication.ts - Code Duplication Rule', () => {
  it('should detect high duplication percentage above threshold', () => {
    const mockAdapterWithDuplication = {
      ...mockAdapter,
      duplicationPercentage: 25
    };
    
    const violations = codeDuplicationRule.check('test.ts', mockAdapterWithDuplication as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.code-duplication');
    expect(violations[0].message).toContain('25%');
  });

  it('should pass for low duplication percentage below threshold', () => {
    const mockAdapterWithLowDuplication = {
      ...mockAdapter,
      duplicationPercentage: 10
    };
    
    const violations = codeDuplicationRule.check('test.ts', mockAdapterWithLowDuplication as any);
    
    expect(violations.length).toBe(0);
  });

  it('should pass for duplication exactly at threshold (15%)', () => {
    const mockAdapterAtThreshold = {
      ...mockAdapter,
      duplicationPercentage: 15
    };
    
    const violations = codeDuplicationRule.check('test.ts', mockAdapterAtThreshold as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold and severity from config', () => {
    expect(codeDuplicationRule.threshold).toBe(15);
    expect(codeDuplicationRule.severity).toBe('warning');
  });

  it('should return empty array when adapter.duplicationPercentage is undefined', () => {
    const violations = codeDuplicationRule.check('test.ts', mockAdapter as any);
    
    expect(violations).toEqual([]);
  });

  it('should return empty array when adapter throws', () => {
    const mockAdapterThrowing = {
      ...mockAdapter,
      duplicationPercentage: () => { throw new Error('jscpd error'); }
    };
    
    const violations = codeDuplicationRule.check('test.ts', mockAdapterThrowing as any);
    
    expect(violations).toEqual([]);
  });

  it('should handle multiple files with duplication', () => {
    const mockAdapterWithDuplication = {
      ...mockAdapter,
      duplicationPercentage: 30,
      duplicatedBlocks: [
        { lines: 10, tokens: 50, files: ['test.ts', 'other.ts'] }
      ]
    };
    
    const violations = codeDuplicationRule.check('test.ts', mockAdapterWithDuplication as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('30%');
  });
});