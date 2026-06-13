import { describe, it, expect } from 'vitest';
import { magicNumbersRule } from '../../clean-code/magic-numbers';

// Mock adapter for testing
const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: (_fileName: string) => 10
};

describe('magicNumbersRule', () => {
  it('should return an empty array for code with only excluded safe values', () => {
    const mockSafeAdapter = {
      ...mockAdapter,
      parseAST: () => undefined,
      extract: () => []
    };

    const violations = magicNumbersRule.check('test-safe.ts', mockSafeAdapter as never);
    expect(violations).toHaveLength(0);
  });

  it('should detect non-safe magic numbers', () => {
    const mockUnsafeAdapter = {
      ...mockAdapter,
      parseAST: () => undefined,
      extract: () => [
        { value: 0.0875, line: 1 },
        { value: 42, line: 2 },
        { value: 99, line: 3 },
        { value: 73, line: 4 }
      ]
    };

    const violations = magicNumbersRule.check('test-unsafe.ts', mockUnsafeAdapter as never);
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
    
    const violations = magicNumbersRule.check('test.ts', mockAdapterThatThrows as never);
    
    expect(violations).toHaveLength(0);
  });
