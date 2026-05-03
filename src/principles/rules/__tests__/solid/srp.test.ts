import { describe, it, expect } from 'vitest';
import { srpRule } from '../../solid/srp';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('srp.ts - Single Responsibility Principle Rule', () => {
  it('should detect class with too many methods (>15)', () => {
    const mockAdapterWithManyMethods = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'MultiResponsibilityClass',
        line: 1,
        methodCount: 18,
        imports: {
          ui: ['Component', 'Styles'],
          data: ['Repository', 'Model'],
          business: ['Service', 'Utils']
        }
      }]
    };
    
    const violations = srpRule.check('test.ts', mockAdapterWithManyMethods as any);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.srp');
  });

  it('should detect import diversity (>3 categories)', () => {
    const mockAdapterWithImportDiversity = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'CrossDomainClass',
        line: 1,
        methodCount: 8,
        imports: {
          ui: ['Component'],
          data: ['Repository'],
          business: ['Service'],
          infrastructure: ['Config']
        }
      }]
    };
    
    const violations = srpRule.check('test.ts', mockAdapterWithImportDiversity as any);
    
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('import');
  });

  it('should pass for focused class', () => {
    const mockAdapterWithFocusedClass = {
      ...mockAdapter,
      extractClasses: () => [{
        name: 'FocusedClass',
        line: 1,
        methodCount: 8,
        imports: {
          data: ['Repository', 'Model']
        }
      }]
    };
    
    const violations = srpRule.check('test.ts', mockAdapterWithFocusedClass as any);
    
    expect(violations.length).toBe(0);
  });

  it('should use threshold from config', () => {
    expect(srpRule.threshold).toBe(15);
    expect(srpRule.severity).toBe('warning');
  });

  it('should return empty violations when adapter throws error', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractClasses: () => { throw new Error('Adapter failed'); }
    };
    
    const violations = srpRule.check('test.ts', mockAdapterThatThrows as any);
    
    expect(violations.length).toBe(0);
  });
});