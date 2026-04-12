import { describe, it, expect } from 'vitest';
import { ispRule } from '../../solid/isp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('isp.ts - Interface Segregation Principle Rule', () => {
  it('should detect interface with too many methods (>10)', () => {
    const mockAdapterWithFatInterface = {
      ...mockAdapter,
      extractInterfaces: () => [{
        name: 'FatInterface',
        line: 1,
        methodCount: 12
      }]
    };
    
    const violations = ispRule.check('test.ts', mockAdapterWithFatInterface as any);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.isp');
    expect(violations[0].message).toContain('12');
  });

  it('should pass for focused interface', () => {
    const mockAdapterWithFocusedInterface = {
      ...mockAdapter,
      extractInterfaces: () => [{
        name: 'ReaderInterface',
        line: 1,
        methodCount: 5
      }]
    };
    
    const violations = ispRule.check('test.ts', mockAdapterWithFocusedInterface as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(ispRule.threshold).toBe(10);
    expect(ispRule.severity).toBe('info');
  });
});