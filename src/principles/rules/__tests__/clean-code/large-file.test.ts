import { describe, it, expect } from 'vitest';
import { largeFileRule } from '../../clean-code/large-file';

// Mock adapter for testing
const mockAdapter = {
  detectLanguage: () => 'typescript',
  parseAST: () => undefined,
  extractFunctions: () => [],
  extractClasses: () => [],
  extractExports: () => [],
  countLines: (_fileName: string) => 10, // Default to small file
  getDuplication: () => ({ percentage: 0, blocks: [] }), declaresRuleCoverage: true
};

describe('largeFileRule', () => {
  it('should return an empty array when file has fewer than threshold lines', () => {
    const shortFileAdapter = {
      ...mockAdapter,
      countLines: () => 499
    } as never;

    const violations = largeFileRule.check('test-short.ts', shortFileAdapter);
    expect(violations).toHaveLength(0);
  });

  it('should detect files exceeding 1150 lines', () => {
    const largeFileAdapter = {
      ...mockAdapter,
      countLines: () => 1151
    };

    const violations = largeFileRule.check('test-large.ts', largeFileAdapter);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: 'test-large.ts',
      line: 1,
      ruleId: 'clean-code.large-file',
      message: 'File is too large: 1151 lines (maximum: 1150)',
      severity: 'warning'
    });
  });

  it('should handle exactly threshold lines as not violating', () => {
    const thresholdFileAdapter = {
      ...mockAdapter,
      countLines: () => 1150
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
    expect(largeFileRule.threshold).toEqual(1150);
  });

  it('should propagate adapter errors (no empty catch, #392)', () => {
    const mockAdapterThatThrows = {
      ...mockAdapter,
      countLines: () => { throw new Error('Adapter failed'); }
    };
    
    expect(() => largeFileRule.check('test.ts', mockAdapterThatThrows)).toThrow('Adapter failed');
  });

  it('treats an adapter that cannot count as zero lines', () => {
    // No measurement is not evidence AGAINST the file: inventing a violation from a
    // missing count is the defect this gate exists to prevent.
    const noCounter = { detectLanguage: () => 'typescript', extractFunctions: () => [] };
    expect(largeFileRule.check('test.ts', noCounter as never)).toHaveLength(0);
  });

  it('passes a file exactly AT the ceiling', () => {
    // The rule is "more than", not "at least": a file at the limit is allowed.
    const atLimit = { ...mockAdapter, countLines: () => 500 };
    expect(largeFileRule.check('test.ts', atLimit)).toHaveLength(0);
  });
});
