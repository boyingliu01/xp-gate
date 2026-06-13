/**
 * @test reporter.ts - Output formatting
 * @intent Verify reporter formats violations for console and other outputs
 * @covers clean-code-solid-checker-design Section 3 (CORE ENGINE)
 */

import { describe, it, expect } from 'vitest';
import { formatConsole, formatJSON, formatSARIF, formatSummary } from '../reporter';
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

    it('should show error count when severity has errors', () => {
      const errorResult: AnalysisResult = {
        violations: [
          {
            file: 'src/auth.ts',
            line: 5,
            ruleId: 'solid.srp',
            message: 'Class handles both auth and logging',
            severity: 'error'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 1,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 30,
        errors: []
      };

      const output = formatSummary(errorResult);

      expect(output).toContain('1 errors');
      expect(output).toContain('0 warnings');
    });
  });

  describe('formatSARIF', () => {
    it('should return valid SARIF JSON with version 2.1.0', () => {
      const result: AnalysisResult = {
        violations: [sampleViolation],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {
          'clean-code.long-function': { violationCount: 1, filesChecked: 1 }
        },
        executionTimeMs: 100,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('2.1.0');
      expect(parsed.$schema).toContain('sarif-schema-2.1.0');
    });

    it('should include runs array with tool driver info', () => {
      const result: AnalysisResult = {
        violations: [sampleViolation],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 3,
          rulesRun: 2
        },
        fileResults: {},
        ruleResults: {
          'clean-code.long-function': { violationCount: 1, filesChecked: 3 }
        },
        executionTimeMs: 95,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);

      expect(parsed.runs).toBeDefined();
      expect(parsed.runs).toHaveLength(1);
      expect(parsed.runs[0].tool.driver.name).toBe('Principles Checker');
      expect(parsed.runs[0].tool.driver.version).toBe('1.0.0');
    });

    it('should map violations to SARIF results with correct levels', () => {
      const result: AnalysisResult = {
        violations: [
          {
            file: 'src/auth.ts',
            line: 5,
            column: 10,
            ruleId: 'solid.srp',
            message: 'Multiple responsibilities',
            severity: 'error'
          },
          {
            file: 'src/utils.ts',
            line: 20,
            ruleId: 'clean-code.long-function',
            message: 'Function too long',
            severity: 'warning'
          },
          {
            file: 'src/config.ts',
            line: 3,
            ruleId: 'clean-code.magic-numbers',
            message: 'Magic number 42',
            severity: 'info'
          }
        ],
        summary: {
          totalViolations: 3,
          errorCount: 1,
          warningCount: 1,
          infoCount: 1,
          filesChecked: 3,
          rulesRun: 3
        },
        fileResults: {},
        ruleResults: {
          'solid.srp': { violationCount: 1, filesChecked: 1 },
          'clean-code.long-function': { violationCount: 1, filesChecked: 1 },
          'clean-code.magic-numbers': { violationCount: 1, filesChecked: 1 }
        },
        executionTimeMs: 200,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const results = parsed.runs[0].results;

      expect(results).toHaveLength(3);
      expect(results[0].level).toBe('error');
      expect(results[1].level).toBe('warning');
      expect(results[2].level).toBe('note');
    });

    it('should include file, line, and column in result locations', () => {
      const result: AnalysisResult = {
        violations: [
          {
            file: 'src/api.ts',
            line: 42,
            column: 15,
            ruleId: 'clean-code.deep-nesting',
            message: 'Nesting depth 6 exceeds threshold 4',
            severity: 'warning'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {
          'clean-code.deep-nesting': { violationCount: 1, filesChecked: 1 }
        },
        executionTimeMs: 80,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const location = parsed.runs[0].results[0].locations[0].physicalLocation;

      expect(location.artifactLocation.uri).toBe('src/api.ts');
      expect(location.region.startLine).toBe(42);
      expect(location.region.startColumn).toBe(15);
    });

    it('should default column to 1 when violation has no column', () => {
      const result: AnalysisResult = {
        violations: [
          {
            file: 'src/big.ts',
            line: 500,
            ruleId: 'clean-code.large-file',
            message: 'File too large',
            severity: 'warning'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {
          'clean-code.large-file': { violationCount: 1, filesChecked: 1 }
        },
        executionTimeMs: 50,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const location = parsed.runs[0].results[0].locations[0].physicalLocation;

      expect(location.region.startColumn).toBe(1);
    });

    it('should include ruleDescriptors for all rules in ruleResults', () => {
      const result: AnalysisResult = {
        violations: [sampleViolation],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 2,
          rulesRun: 2
        },
        fileResults: {},
        ruleResults: {
          'clean-code.long-function': { violationCount: 1, filesChecked: 2 },
          'clean-code.missing-error-handling': { violationCount: 0, filesChecked: 2 }
        },
        executionTimeMs: 60,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const rules = parsed.runs[0].tool.driver.rules;

      expect(rules).toHaveLength(2);
      expect(rules[0].id).toBe('clean-code.long-function');
      expect(rules[0].shortDescription.text).toContain('Function');
      expect(rules[1].id).toBe('clean-code.missing-error-handling');
      expect(rules[1].shortDescription.text).toContain('error handling');
    });

    it('should include execution properties (filesChecked, rulesRun, executionTimeMs)', () => {
      const result: AnalysisResult = {
        violations: [],
        summary: {
          totalViolations: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 10,
          rulesRun: 5
        },
        fileResults: {},
        ruleResults: {
          'clean-code.long-function': { violationCount: 0, filesChecked: 10 }
        },
        executionTimeMs: 150,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const props = parsed.runs[0].properties;

      expect(props.filesChecked).toBe(10);
      expect(props.rulesRun).toBe(5);
      expect(props.executionTimeMs).toBe(150);
    });

    it('should return empty results array when no violations', () => {
      const result: AnalysisResult = {
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
        ruleResults: {
          'clean-code.long-function': { violationCount: 0, filesChecked: 5 }
        },
        executionTimeMs: 30,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);

      expect(parsed.runs[0].results).toEqual([]);
    });

    it('should map DIP violation to error level when violation severity is error', () => {
      const result: AnalysisResult = {
        violations: [
          {
            file: 'src/service.ts',
            line: 8,
            column: 1,
            ruleId: 'solid.dip',
            message: 'Direct instantiation detected',
            severity: 'error'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 1,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {
          'solid.dip': { violationCount: 1, filesChecked: 1 }
        },
        executionTimeMs: 25,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);

      expect(parsed.runs[0].results[0].level).toBe('error');
    });

    it('should include ruleDescriptors with defaultConfiguration levels', () => {
      const result: AnalysisResult = {
        violations: [],
        summary: {
          totalViolations: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 3
        },
        fileResults: {},
        ruleResults: {
          'solid.srp': { violationCount: 0, filesChecked: 1 },
          'clean-code.long-function': { violationCount: 0, filesChecked: 1 },
          'clean-code.magic-numbers': { violationCount: 0, filesChecked: 1 }
        },
        executionTimeMs: 40,
        errors: []
      };

      const output = formatSARIF(result);
      const parsed = JSON.parse(output);
      const rules = parsed.runs[0].tool.driver.rules;

      const srpRule = rules.find((r: { id: string }) => r.id === 'solid.srp');
      const longFuncRule = rules.find((r: { id: string }) => r.id === 'clean-code.long-function');
      const magicNumRule = rules.find((r: { id: string }) => r.id === 'clean-code.magic-numbers');

      expect(srpRule.defaultConfiguration.level).toBe('error');
      expect(longFuncRule.defaultConfiguration.level).toBe('warning');
      expect(magicNumRule.defaultConfiguration.level).toBe('note');
    });
  });

  describe('formatConsole - additional cases', () => {
    it('should show error severity with ✗ icon', () => {
      const errorResult: AnalysisResult = {
        violations: [
          {
            file: 'src/auth.ts',
            line: 5,
            column: 1,
            ruleId: 'solid.srp',
            message: 'Multiple responsibilities',
            severity: 'error'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 1,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 30,
        errors: []
      };

      const output = formatConsole(errorResult);

      expect(output).toContain('✗');
      expect(output).toContain('ERROR');
    });

    it('should show info severity with ℹ icon', () => {
      const infoResult: AnalysisResult = {
        violations: [
          {
            file: 'src/config.ts',
            line: 3,
            column: 10,
            ruleId: 'clean-code.magic-numbers',
            message: 'Magic number 42',
            severity: 'info'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 0,
          infoCount: 1,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 20,
        errors: []
      };

      const output = formatConsole(infoResult);

      expect(output).toContain('ℹ');
      expect(output).toContain('INFO');
    });

    it('should handle violations without column number', () => {
      const noColumnResult: AnalysisResult = {
        violations: [
          {
            file: 'src/big.ts',
            line: 600,
            ruleId: 'clean-code.large-file',
            message: 'File is too large: 600 lines (maximum: 500)',
            severity: 'warning'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 1,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 25,
        errors: []
      };

      const output = formatConsole(noColumnResult);

      expect(output).toContain('line 600');
      expect(output).not.toContain('col');
    });

    it('should include analysis errors only when violations exist', () => {
      const resultWithErrors: AnalysisResult = {
        violations: [
          {
            file: 'src/test.ts',
            line: 5,
            column: 1,
            ruleId: 'clean-code.long-function',
            message: 'Function too long',
            severity: 'warning'
          }
        ],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 2,
          rulesRun: 1
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 50,
        errors: [
          'Rule clean-code.long-function failed on src/corrupt.ts: Parse error',
          'Rule solid.srp failed on src/broken.ts: Timeout'
        ]
      };

      const output = formatConsole(resultWithErrors);

      expect(output).toContain('Analysis errors');
      expect(output).toContain('Parse error');
      expect(output).toContain('Timeout');
    });

    it('should not show analysis errors section when errors array is empty', () => {
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

      expect(output).not.toContain('Analysis errors');
    });

    it('should show files checked in empty violations output', () => {
      const emptyResult: AnalysisResult = {
        violations: [],
        summary: {
          totalViolations: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          filesChecked: 15,
          rulesRun: 8
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 75,
        errors: []
      };

      const output = formatConsole(emptyResult);

      expect(output).toContain('Files checked: 15');
      expect(output).toContain('Rules run: 8');
      expect(output).toContain('75ms');
    });

    it('should include summary section with violation details', () => {
      const mixedResult: AnalysisResult = {
        violations: [
          {
            file: 'src/a.ts',
            line: 5,
            column: 1,
            ruleId: 'solid.srp',
            message: 'SRP violation',
            severity: 'error'
          },
          {
            file: 'src/b.ts',
            line: 10,
            ruleId: 'clean-code.long-function',
            message: 'Too long',
            severity: 'warning'
          }
        ],
        summary: {
          totalViolations: 2,
          errorCount: 1,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 2,
          rulesRun: 2
        },
        fileResults: {},
        ruleResults: {},
        executionTimeMs: 60,
        errors: []
      };

      const output = formatConsole(mixedResult);

      expect(output).toContain('2 violations total');
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
      expect(output).toContain('2 files checked');
      expect(output).toContain('2 rules run');
    });
  });

  describe('formatJSON - additional cases', () => {
    it('should include empty arrays for no violations', () => {
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
        executionTimeMs: 30,
        errors: []
      };

      const output = formatJSON(emptyResult);
      const parsed = JSON.parse(output);

      expect(parsed.violations).toEqual([]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.executionTimeMs).toBe(30);
    });

    it('should include all fields: violations, summary, fileResults, ruleResults, executionTimeMs, errors', () => {
      const result: AnalysisResult = {
        violations: [sampleViolation],
        summary: {
          totalViolations: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          filesChecked: 3,
          rulesRun: 2
        },
        fileResults: {
          'src/test.ts': { violations: [sampleViolation], ruleIds: ['clean-code.long-function'] }
        },
        ruleResults: {
          'clean-code.long-function': { violationCount: 1, filesChecked: 3 }
        },
        executionTimeMs: 120,
        errors: ['Some analysis error']
      };

      const output = formatJSON(result);
      const parsed = JSON.parse(output);

      expect(parsed.violations).toHaveLength(1);
      expect(parsed.summary.totalViolations).toBe(1);
      expect(parsed.fileResults['src/test.ts'].ruleIds).toContain('clean-code.long-function');
      expect(parsed.ruleResults['clean-code.long-function'].violationCount).toBe(1);
      expect(parsed.executionTimeMs).toBe(120);
      expect(parsed.errors).toEqual(['Some analysis error']);
    });
  });
});