/**
 * @test reporter.ts - Output formatting
 * @intent Verify reporter formats violations for console and other outputs
 * @covers clean-code-solid-checker-design Section 3 (CORE ENGINE)
 */

import { describe, it, expect } from 'vitest';
import { formatConsole, formatJSON, formatSummary, ReporterOutput } from '../reporter';
import { AnalysisResult, Violation } from '../analyzer';

describe('reporter.ts - Output Formatting', () => {
  const sampleViolation: Violation = {
    file: 'src/test.ts',
    line: 10,
    column: 5,
    ruleId: 'clean-code.long-function',
    message: 'Function "processData" is too long: 65 lines (maximum: 50)',
    severity: 'warning'
  };

  const sampleResult: AnalysisResult = {
    violations: [
      sampleViolation,
      {
        file: 'src/utils.ts',
        line: 1,
        ruleId: 'clean-code.large-file',
        message: 'File is too large: 600 lines (maximum: 500)',
        severity: 'warning'
      },
      {
        file: 'src/api.ts',
        line: 20,
        ruleId: 'solid.dip',
        message: 'Direct instantiation detected: new UserRepository()',
        severity: 'warning'
      }
    ],
    summary: {
      totalViolations: 3,
      errorCount: 0,
      warningCount: 3,
      infoCount: 0,
      filesChecked: 3,
      rulesRun: 3
    },
    fileResults: {
      'src/test.ts': { violations: [sampleViolation], ruleIds: ['clean-code.long-function'] }
    },
    ruleResults: {
      'clean-code.long-function': { violationCount: 1, filesChecked: 3 }
    },
    executionTimeMs: 150,
    errors: []
  };

  describe('formatConsole', () => {
    it('should format violations as human-readable console output', () => {
      const output = formatConsole(sampleResult);
      
      expect(output).toContain('clean-code.long-function');
      expect(output).toContain('Function "processData" is too long');
      expect(output).toContain('src/test.ts');
      expect(output).toContain('line 10');
    });

    it('should group violations by file', () => {
      const output = formatConsole(sampleResult);
      
      expect(output).toContain('src/test.ts');
      expect(output).toContain('src/utils.ts');
      expect(output).toContain('src/api.ts');
    });

    it('should show severity indicators', () => {
      const output = formatConsole(sampleResult);
      
      expect(output).toContain('⚠');
      expect(output).toContain('WARNING');
    });

    it('should show execution time', () => {
      const output = formatConsole(sampleResult);
      
      expect(output).toContain('150ms');
      expect(output).toContain('Execution time');
    });

    it('should handle empty violations', () => {
      const emptyResult: AnalysisResult = {
        violations: [],
        summary: {
          totalViolations: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 5,
          rulesRun: 3
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 50,
        errors: []
      };
      
      const output = formatConsole(emptyResult);
      
      expect(output).toContain('✓');
      expect(output).toContain('No violations found');
    });
  });

  describe('formatJSON', () => {
    it('should output valid JSON structure', () => {
      const output = formatJSON(sampleResult);
      const parsed = JSON.parse(output);
      
      expect(parsed.violations).toBeDefined();
      expect(parsed.summary).toBeDefined();
      expect(parsed.executionTimeMs).toBe(150);
    });

    it('should include all violation details', () => {
      const output = formatJSON(sampleResult);
      const parsed = JSON.parse(output);
      
      expect(parsed.violations[0].file).toBe('src/test.ts');
      expect(parsed.violations[0].ruleId).toBe('clean-code.long-function');
    });

    it('should be parseable for downstream tools', () => {
      const output = formatJSON(sampleResult);
      
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('formatSummary', () => {
    it('should show total violations count', () => {
      const output = formatSummary(sampleResult);
      
      expect(output).toContain('3 violations');
    });

    it('should show breakdown by severity', () => {
      const output = formatSummary(sampleResult);
      
      expect(output).toContain('0 errors');
      expect(output).toContain('3 warnings');
      expect(output).toContain('0 info');
    });

    it('should show files and rules checked', () => {
      const output = formatSummary(sampleResult);
      
      expect(output).toContain('3 files');
      expect(output).toContain('3 rules');
    });

    it('should indicate pass/fail status', () => {
      const output = formatSummary(sampleResult);
      
      expect(output).toContain('FAIL');
    });

    it('should show PASS when no violations', () => {
      const emptyResult: AnalysisResult = {
        violations: [],
        summary: {
          totalViolations: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 5,
          rulesRun: 3
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 50,
        errors: []
      };
      
      const output = formatSummary(emptyResult);
      
      expect(output).toContain('PASS');
    });
  });
});