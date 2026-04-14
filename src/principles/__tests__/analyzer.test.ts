/**
 * @test analyzer.ts - Rule orchestration engine
 * @intent Verify analyzer runs rules and aggregates violations correctly
 * @covers clean-code-solid-checker-design Section 3 (CORE ENGINE)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyze, AnalysisResult } from '../analyzer';
import { Rule, Violation, Adapter, Severity } from '../types';
import { loadConfig } from '../config';

describe('analyzer.ts - Rule Orchestration Engine', () => {
  let mockAdapter: Adapter;
  let mockRule: Rule;
  
  beforeEach(() => {
    // Mock adapter
    mockAdapter = {
      detectLanguage: vi.fn().mockReturnValue('typescript'),
      parseAST: vi.fn().mockReturnValue({}),
      extractFunctions: vi.fn().mockReturnValue([
        { name: 'testFunc', startLine: 1, length: 60 }
      ]),
      extractClasses: vi.fn().mockReturnValue([]),
      countLines: vi.fn().mockReturnValue(100)
    };
    
    // Mock rule that detects violations
    mockRule = {
      id: 'clean-code.long-function',
      name: 'Long Function Rule',
      threshold: 50,
      severity: 'warning' as Severity,
      check: vi.fn().mockReturnValue([
        {
          file: 'test.ts',
          line: 1,
          ruleId: 'clean-code.long-function',
          message: 'Function "testFunc" is too long: 60 lines (maximum: 50)',
          severity: 'warning' as Severity
        }
      ])
    };
  });

  describe('analyze function', () => {
    it('should return AnalysisResult with violations array', async () => {
      const files = ['test.ts'];
      const rules = [mockRule];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result).toBeDefined();
      expect(result.violations).toBeInstanceOf(Array);
      expect(result.summary).toBeDefined();
    });

    it('should run each rule against each file', async () => {
      const files = ['test.ts', 'test2.ts'];
      const rules = [mockRule];
      
      await analyze(files, rules, mockAdapter);
      
      // Each file should be checked
      expect(mockRule.check).toHaveBeenCalledTimes(2);
    });

    it('should aggregate violations from all rules', async () => {
      const files = ['test.ts'];
      const rules = [
        mockRule,
        {
          id: 'clean-code.large-file',
          name: 'Large File Rule',
          threshold: 500,
          severity: 'warning' as Severity,
          check: vi.fn().mockReturnValue([
            {
              file: 'test.ts',
              line: 1,
              ruleId: 'clean-code.large-file',
              message: 'File is too large: 600 lines',
              severity: 'warning' as Severity
            }
          ])
        } as Rule
      ];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.violations.length).toBe(2);
      expect(result.violations[0].ruleId).toBe('clean-code.long-function');
      expect(result.violations[1].ruleId).toBe('clean-code.large-file');
    });

    it('should filter rules by enabled config', async () => {
      const config = await loadConfig();
      const files = ['test.ts'];
      
      // Mock a disabled rule
      const disabledRule = {
        id: 'clean-code.disabled-rule',
        name: 'Disabled Rule',
        threshold: 10,
        severity: 'info' as Severity,
        check: vi.fn().mockReturnValue([])
      };
      
      const result = await analyze(files, [mockRule, disabledRule], mockAdapter, {
        enabledRules: ['clean-code.long-function']
      });
      
      // Only enabled rule should run
      expect(mockRule.check).toHaveBeenCalled();
      expect(disabledRule.check).not.toHaveBeenCalled();
    });

    it('should return empty violations if all rules pass', async () => {
      const passingRule: Rule = {
        id: 'clean-code.passing',
        name: 'Passing Rule',
        threshold: 50,
        severity: 'warning' as Severity,
        check: vi.fn().mockReturnValue([])
      };
      
      const files = ['clean.ts'];
      const result = await analyze(files, [passingRule], mockAdapter);
      
      expect(result.violations.length).toBe(0);
      expect(result.summary.totalViolations).toBe(0);
    });

    it('should calculate summary statistics correctly', async () => {
      const files = ['test.ts'];
      const rules = [mockRule];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.summary.totalViolations).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.errorCount).toBe(0);
      expect(result.summary.infoCount).toBe(0);
    });

    it('should handle multiple severity levels in summary', async () => {
      const files = ['test.ts'];
      const rules = [
        mockRule,
        {
          id: 'test.error',
          name: 'Error Rule',
          threshold: 10,
          severity: 'error' as Severity,
          check: vi.fn().mockReturnValue([
            {
              file: 'test.ts',
              line: 1,
              ruleId: 'test.error',
              message: 'Error violation',
              severity: 'error' as Severity
            }
          ])
        } as Rule,
        {
          id: 'test.info',
          name: 'Info Rule',
          threshold: 10,
          severity: 'info' as Severity,
          check: vi.fn().mockReturnValue([
            {
              file: 'test.ts',
              line: 2,
              ruleId: 'test.info',
              message: 'Info violation',
              severity: 'info' as Severity
            }
          ])
        } as Rule
      ];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.infoCount).toBe(1);
      expect(result.summary.totalViolations).toBe(3);
    });

it('should skip files that do not match adapter language', async () => {
      const files = ['test.py', 'test.ts'];
      
      const adapterFactory = (filePath: string): Adapter => {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext === 'ts' || ext === 'tsx') {
          return mockAdapter;
        }
        return {
          ...mockAdapter,
          detectLanguage: () => 'unknown'
        };
      };
      
      const result = await analyze(files, [mockRule], adapterFactory);
      
      expect(mockRule.check).toHaveBeenCalledTimes(1);
    });

    it('should handle rule check errors gracefully', async () => {
      const errorRule: Rule = {
        id: 'error.rule',
        name: 'Error Rule',
        threshold: 10,
        severity: 'warning' as Severity,
        check: vi.fn().mockImplementation(() => {
          throw new Error('Rule check failed');
        })
      };
      
      const files = ['test.ts'];
      
      // Should not throw, should handle gracefully
      const result = await analyze(files, [errorRule], mockAdapter);
      
      expect(result.violations.length).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('AnalysisResult structure', () => {
    it('should include file-by-file breakdown', async () => {
      const files = ['test.ts'];
      const rules = [mockRule];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.fileResults).toBeDefined();
      expect(result.fileResults['test.ts']).toBeDefined();
      expect(result.fileResults['test.ts'].violations.length).toBe(1);
    });

    it('should include execution time', async () => {
      const files = ['test.ts'];
      const rules = [mockRule];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.executionTimeMs).toBeDefined();
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should include rule-by-rule breakdown', async () => {
      const files = ['test.ts'];
      const rules = [mockRule];
      
      const result = await analyze(files, rules, mockAdapter);
      
      expect(result.ruleResults).toBeDefined();
      expect(result.ruleResults['clean-code.long-function']).toBeDefined();
      expect(result.ruleResults['clean-code.long-function'].violationCount).toBe(1);
    });
  });
});