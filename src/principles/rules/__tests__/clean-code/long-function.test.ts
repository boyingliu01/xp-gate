import { describe, it, expect } from 'vitest';
import { longFunctionRule } from '../../clean-code/long-function';

// Mock adapter for testing
const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: (content: string) => content.split('\n').length
};

describe('longFunctionRule', () => {
  it('should return an empty array when no long function is detected', () => {
    const mockShortAdapter = {
      ...mockAdapter,
      extractFunctions: () => [
        { name: 'shortFunction', startLine: 1, endLine: 40, length: 40 }
      ]
    };

    const violations = longFunctionRule.check('test.ts', mockShortAdapter as any);
    expect(violations).toHaveLength(0);
  });

  it('should detect long functions exceeding 50 lines', () => {
    const mockLongAdapter = {
      ...mockAdapter,
      extractFunctions: () => [
        { name: 'veryLongFunction', startLine: 1, endLine: 55, length: 55 }
      ]
    };

    const violations = longFunctionRule.check('test.ts', mockLongAdapter as any);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: 'test.ts',
      line: 1,
      ruleId: 'clean-code.long-function',
      message: 'Function "veryLongFunction" is too long: 55 lines (maximum: 50)',
      severity: 'warning'
    });
  });

  it('should handle multiple functions in a file', () => {
    const mockMultiAdapter = {
      ...mockAdapter,
      extractFunctions: () => [
        { name: 'shortFunction', startLine: 1, endLine: 4, length: 4 },
        { name: 'alsoLongFunction', startLine: 6, endLine: 62, length: 57 }
      ]
    };

    const violations = longFunctionRule.check('test.ts', mockMultiAdapter as any);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toEqual('clean-code.long-function');
    expect(violations[0].message).toContain('alsoLongFunction');
    expect(violations[0].message).toContain('57 lines');
  });

  it('should use the correct rule identifier', () => {
    expect(longFunctionRule.id).toEqual('clean-code.long-function');
  });

  it('should have the correct severity', () => {
    expect(longFunctionRule.severity).toEqual('warning');
  });

  it('should use the correct threshold', () => {
    expect(longFunctionRule.threshold).toEqual(50);
  });
});