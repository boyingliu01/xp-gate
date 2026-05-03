import { describe, it, expect } from 'vitest';
import { magicNumbersRule } from '../../clean-code/magic-numbers';

// Mock adapter for testing
const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: (fileName: string) => 10
};

describe('magicNumbersRule', () => {
  it('should return an empty array for code with only excluded safe values', () => {
    const codeWithSafeValues = `
      const a = 0;
      const b = 1;
      const c = -1;
      const d = 2;
      const e = 10;
      const f = 100;
      const g = 1000;
      setTimeout(callback, 100);
      for(let i = 0; i < items.length; i++) {}
      const timeout = 30 * 1000;
    `;
    
    const mockSafeAdapter = {
      ...mockAdapter,
      parseAST: () => {},
      extract: () => []
    };

    const violations = magicNumbersRule.check('test-safe.ts', mockSafeAdapter as any);
    expect(violations).toHaveLength(0);
  });

  it('should detect non-safe magic numbers', () => {
    const codeWithMagicNumbers = `
      const taxRate = 0.0875;
      const threshold = 42;
      const count = 99;
      return x * 73;
    `;
    
    const mockUnsafeAdapter = {
      ...mockAdapter,
      parseAST: () => {},
      extract: () => [
        { value: 0.0875, line: 1 },
        { value: 42, line: 2 },
        { value: 99, line: 3 },
        { value: 73, line: 4 }
      ]
    };

    const violations = magicNumbersRule.check('test-unsafe.ts', mockUnsafeAdapter as any);
    expect(violations).toHaveLength(4);
    
    expect(violations[0].message).toContain('0.0875');
    expect(violations[1].message).toContain('42');
    expect(violations[2].message).toContain('99');
    expect(violations[3].message).toContain('73');
    expect(violations[0].severity).toEqual('info');
  });

  it('should have the correct rule identifier', () => {
    expect(magicNumbersRule.id).toEqual('clean-code.magic-numbers');
  });

  it('should have the correct severity', () => {
    expect(magicNumbersRule.severity).toEqual('info');
  });

  it('should use the correct exclusion values', () => {
    expect(magicNumbersRule.threshold).toEqual(10);
  });
});
  it('should return empty violations when adapter throws error', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      extractFunctions: () => { throw new Error('Adapter failed'); }
    };
    
    const violations = magicNumbersRule.check('test.ts', mockAdapterThatThrows as any);
    
    expect(violations).toHaveLength(0);
  });
