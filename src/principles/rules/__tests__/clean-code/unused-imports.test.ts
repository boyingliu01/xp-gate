import { describe, it, expect } from 'vitest';
import { unusedImportsRule } from '../../clean-code/unused-imports';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('unused-imports.ts - Unused Imports Rule', () => {
  it('should detect unused value import', () => {
    const mockAdapterWithUnusedImport = {
      ...mockAdapter,
      imports: [
        { name: 'lodash', line: 1, type: 'value', used: false },
        { name: 'fs', line: 2, type: 'value', used: true }
      ]
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterWithUnusedImport as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.unused-imports');
    expect(violations[0].message).toContain('lodash');
  });

  it('should pass for used imports', () => {
    const mockAdapterWithUsedImports = {
      ...mockAdapter,
      imports: [
        { name: 'fs', line: 1, type: 'value', used: true },
        { name: 'path', line: 2, type: 'value', used: true }
      ]
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterWithUsedImports as any);
    
    expect(violations.length).toBe(0);
  });

  it('should skip type-only imports (TypeScript)', () => {
    const mockAdapterWithTypeImports = {
      ...mockAdapter,
      imports: [
        { name: 'User', line: 1, type: 'type', used: false },
        { name: 'fs', line: 2, type: 'value', used: true }
      ]
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterWithTypeImports as any);
    
    expect(violations.length).toBe(0);
  });

  it('should detect multiple unused imports', () => {
    const mockAdapterWithMultipleUnused = {
      ...mockAdapter,
      imports: [
        { name: 'lodash', line: 1, type: 'value', used: false },
        { name: 'axios', line: 2, type: 'value', used: false },
        { name: 'fs', line: 3, type: 'value', used: true }
      ]
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterWithMultipleUnused as any);
    
    expect(violations.length).toBe(2);
  });

  it('should use severity from config', () => {
    expect(unusedImportsRule.severity).toBe('info');
  });

  it('should return empty array when adapter.imports is undefined', () => {
    const violations = unusedImportsRule.check('test.ts', mockAdapter as any);
    
    expect(violations).toEqual([]);
  });

  it('should return empty array when adapter throws', () => {
    const mockAdapterThrowing = {
      ...mockAdapter,
      imports: () => { throw new Error('Parse error'); }
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterThrowing as any);
    
    expect(violations).toEqual([]);
  });

  it('should handle namespace imports', () => {
    const mockAdapterWithNamespaceImport = {
      ...mockAdapter,
      imports: [
        { name: '* as fs', line: 1, type: 'namespace', used: true },
        { name: '* as lodash', line: 2, type: 'namespace', used: false }
      ]
    };
    
    const violations = unusedImportsRule.check('test.ts', mockAdapterWithNamespaceImport as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('lodash');
  });
});