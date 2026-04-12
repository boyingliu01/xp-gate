import { describe, it, expect } from 'vitest';
import { largeFileRule } from '../../clean-code/large-file';

// Mock adapter for testing
const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => {},
  extractFunctions: () => [],
  extractClasses: () => [],
  countLines: (fileName: string) => 10 // Default to small file
};

describe('largeFileRule', () => {
  it('should return an empty array when file has fewer than 500 lines', () => {
    const shortFileAdapter: any = {
      ...mockAdapter,
      countLines: () => 499
    };

    const violations = largeFileRule.check('test-short.ts', shortFileAdapter);
    expect(violations).toHaveLength(0);
  });

  it('should detect files exceeding 500 lines', () => {
    const largeFileAdapter: any = {
      ...mockAdapter,
      countLines: () => 501
    };

    const violations = largeFileRule.check('test-large.ts', largeFileAdapter);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: 'test-large.ts',
      line: 1,
      ruleId: 'clean-code.large-file',
      message: 'File is too large: 501 lines (maximum: 500)',
      severity: 'warning'
    });
  });

  it('should handle exactly threshold lines as not violating', () => {
    const thresholdFileAdapter: any = {
      ...mockAdapter,
      countLines: () => 500
    };

    const violations = largeFileRule.check('test-threshold.ts', thresholdFileAdapter);
    expect(violations).toHaveLength(0);
  });

  it('should use the correct rule identifier', () => {
    expect(largeFileRule.id).toEqual('clean-code.large-file');
  });

  it('should have the correct severity', () => {
    expect(largeFileRule.severity).toEqual('warning');
  });

  it('should use the correct threshold', () => {
    expect(largeFileRule.threshold).toEqual(500);
  });
});