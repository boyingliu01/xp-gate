import { describe, it, expect } from 'vitest';
import { missingErrorHandlingRule } from '../../clean-code/missing-error-handling';

const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: () => 0
};

describe('missing-error-handling.ts - Missing Error Handling Rule', () => {
  it('should detect async function with fetch without try-catch', () => {
    const mockAdapterWithIO = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'loadData',
        startLine: 10,
        code: `
async function loadData(url: string) {
  const response = await fetch(url);
  return response.json();
}
`,
        isAsync: true,
        ioOperations: ['fetch']
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithIO as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.missing-error-handling');
    expect(violations[0].message).toContain('fetch');
  });

  it('should detect async function with fs.readFile without try-catch', () => {
    const mockAdapterWithIO = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'readConfig',
        startLine: 20,
        code: `
async function readConfig(path: string) {
  const data = await fs.readFile(path, 'utf-8');
  return JSON.parse(data);
}
`,
        isAsync: true,
        ioOperations: ['fs.readFile']
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithIO as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.missing-error-handling');
    expect(violations[0].message).toContain('fs.readFile');
  });

  it('should pass for async function with try-catch wrapping IO', () => {
    const mockAdapterWithHandledIO = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'loadDataSafe',
        startLine: 30,
        code: `
async function loadDataSafe(url: string) {
  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    logger.error('Failed to load', error);
    return null;
  }
}
`,
        isAsync: true,
        ioOperations: ['fetch'],
        hasTryCatch: true
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithHandledIO as any);
    
    expect(violations.length).toBe(0);
  });

  it('should pass for pure function without IO operations', () => {
    const mockAdapterWithPureFunction = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'calculateTotal',
        startLine: 40,
        code: `
function calculateTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
`,
        isAsync: false,
        ioOperations: []
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithPureFunction as any);
    
    expect(violations.length).toBe(0);
  });

  it('should detect axios call without error handling', () => {
    const mockAdapterWithAxios = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'fetchUser',
        startLine: 50,
        code: `
async function fetchUser(id: string) {
  const response = await axios.get('/api/users/' + id);
  return response.data;
}
`,
        isAsync: true,
        ioOperations: ['axios']
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithAxios as any);
    
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.missing-error-handling');
  });

  it('should use severity from config', () => {
    expect(missingErrorHandlingRule.severity).toBe('warning');
  });

  it('should return empty array when adapter.extractFunctions throws', () => {
    const mockAdapterThrowing = {
      ...mockAdapter,
      extractFunctions: () => { throw new Error('Parse error'); }
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterThrowing as any);
    
    expect(violations).toEqual([]);
  });

  it('should detect multiple IO operations in one function', () => {
    const mockAdapterWithMultipleIO = {
      ...mockAdapter,
      extractFunctions: () => [{
        name: 'processData',
        startLine: 60,
        code: `
async function processData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  await fs.writeFile('output.json', JSON.stringify(data));
  return data;
}
`,
        isAsync: true,
        ioOperations: ['fetch', 'fs.writeFile']
      }]
    };
    
    const violations = missingErrorHandlingRule.check('test.ts', mockAdapterWithMultipleIO as any);
    
    // Should detect at least one violation (function needs try-catch)
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].ruleId).toBe('clean-code.missing-error-handling');
  });
});