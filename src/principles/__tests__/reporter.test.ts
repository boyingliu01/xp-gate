/**
 * @test reporter.ts - Output formatting
 * @intent Verify reporter formats violations for console and other outputs
 * @covers clean-code-solid-checker-design Section 3 (CORE ENGINE)
 */

import { describe, it, expect } from 'vitest';
import { formatConsole, formatJSON, formatSARIF, formatSummary } from '../reporter';
import { AnalysisResult, Violation } from '../analyzer';

/**
 * Build an AnalysisResult summary.
 *
 * Extracted because these fixtures were written out in full 25 times, which the
 * clean-code.code-duplication rule scored at 44.2% (threshold 15%) and the Boy
 * Scout gate then blocked. The counts are positional rather than a params object
 * because every call site already reads as one line of counts, and a named-field
 * object per fixture would be longer than the literal it replaces.
 *
 * `unanalysedLanguages` defaults to empty: no fixture here exercises the
 * not-analysed notice, and tests that do set it explicitly via the options and
 * assert on it there.
 */
function summaryOf(
  totalViolations: number,
  errorCount: number,
  warningCount: number,
  infoCount: number,
  filesChecked: number,
  rulesRun: number,
  unanalysedLanguages: string[] = []
): AnalysisResult['summary'] {
  return {
    totalViolations,
    errorCount,
    warningCount,
    infoCount,
    filesChecked,
    rulesRun,
    unanalysedLanguages,
  };
}

/**
 * The empty `fileResults` / `ruleResults` / `errors` set plus a duration.
 *
 * These lines appeared verbatim in 14 fixtures -- the remainder of the
 * duplication the `summaryOf` extraction above did not reach (`errors: []` alone
 * accounted for 21 of the repeated 3-line windows). Kept separate from summaryOf
 * because the two vary independently: several tests supply real ruleResults, and
 * one supplies a NaN errorCount.
 */
function emptyResults(executionTimeMs: number): Pick<
  AnalysisResult,
  'fileResults' | 'ruleResults' | 'executionTimeMs' | 'errors'
> {
  return { fileResults: {}, ruleResults: {}, executionTimeMs, errors: [] };
}

/**
 * Build a Violation.
 *
 * These were written out as five-to-six line object literals 17 times, which the
 * clean-code.code-duplication rule scored well above its 15% threshold and the
 * Boy Scout gate blocked. Named fields would be longer than the literal they
 * replace and would bury the one thing each fixture is really saying -- which
 * file, which rule, which message -- so the two axes stay positional here.
 *
 * `column` is optional because only the first fixture asserts on it.
 */
function violation(
  file: string,
  line: number,
  ruleId: string,
  message: string,
  severity: Violation['severity'],
  column?: number
): Violation {
  return column === undefined
    ? { file, line, ruleId, message, severity }
    : { file, line, column, ruleId, message, severity };
}

describe('reporter.ts - Output Formatting', () => {
  const sampleViolation: Violation = violation("src/test.ts", 10, "clean-code.long-function", "Function \"processData\" is too long: 65 lines (maximum: 50)", "warning", 5);

  const sampleResult: AnalysisResult = {
    violations: [
      sampleViolation,
      violation("src/utils.ts", 1, "clean-code.large-file", "File is too large: 600 lines (maximum: 500)", "warning"),
      violation("src/api.ts", 20, "solid.dip", "Direct instantiation detected: new UserRepository()", "warning")
    ],
    summary: summaryOf(3, 0, 3, 0, 3, 3),
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
        summary: summaryOf(0, 0, 0, 0, 5, 3),
        ...emptyResults(50),
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

    it('should not read a missing summary as FAIL (NaN must not decide the verdict)', () => {
      // Round 3 of the Delphi review, three seats independently: `undefined + 0`
      // is NaN, and `NaN === 0` is false, so an incomplete summary would make
      // this report FAIL unconditionally -- the exact symptom the info fix
      // removed, reintroduced through a different door. formatSummary is
      // exported, so it cannot assume its caller honoured the type.
      const noSummary = {
        violations: [],
        ...emptyResults(1),
      } as unknown as AnalysisResult;

      const output = formatSummary(noSummary);
      expect(output).toContain('PASS');
      expect(output).not.toContain('NaN');
    });

    it('should flag a malformed summary instead of silently treating it as clean', () => {
      // Round 5, three seats independently: zeroing a non-numeric count stops the
      // permanent-FAIL bug but also swallows an upstream defect -- a corrupted
      // summary would read as "nothing to report". Keep the non-blocking verdict
      // (crashing the reporter would be worse) but say so in the output.
      const corrupted = {
        violations: [],
        summary: summaryOf(1, Number.NaN, 0, 0, 1, 1),
        ...emptyResults(1),
      } as unknown as AnalysisResult;

      const output = formatSummary(corrupted);
      expect(output).toMatch(/malformed|invalid|corrupt/i);
      // The damaged field must be named, so a reader can tell WHICH count is
      // untrustworthy. Echoing the raw value is the point of the diagnostic --
      // only the verdict must never be decided by it.
      expect(output).toContain('errorCount');
      expect(output).toContain('PASS');
    });

    it('should show PASS when the only findings are info (info is log-only)', () => {
      // AGENTS.md: info = "log only". An info finding is how a rule says "I
      // could not judge this file" (the arch layout diagnostic), so treating it
      // as a failure would block a commit for a blind spot rather than a defect.
      const infoOnly: AnalysisResult = {
        violations: [
          violation("java/com/acme/UserController.java", 1, "arch.controller", "Skipped: no recognisable Java source root", "info")
        ],
        summary: summaryOf(1, 0, 0, 1, 1, 1),
        ...emptyResults(1),
      };
      const output = formatSummary(infoOnly);
      expect(output).toContain('PASS');
      expect(output).not.toContain('FAIL');
    });

    it('should show PASS when no violations', () => {
      const emptyResult: AnalysisResult = {
        violations: [],
        summary: summaryOf(0, 0, 0, 0, 5, 3),
        ...emptyResults(50),
      };
      
      const output = formatSummary(emptyResult);
      
      expect(output).toContain('PASS');
    });

    it('should show error count when severity has errors', () => {
      const errorResult: AnalysisResult = {
        violations: [
          violation("src/auth.ts", 5, "solid.srp", "Class handles both auth and logging", "error")
        ],
        summary: summaryOf(1, 1, 0, 0, 1, 1),
        ...emptyResults(30),
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
        summary: summaryOf(1, 0, 1, 0, 1, 1),
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
        summary: summaryOf(1, 0, 1, 0, 3, 2),
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
          violation("src/auth.ts", 5, "solid.srp", "Multiple responsibilities", "error", 10),
          violation("src/utils.ts", 20, "clean-code.long-function", "Function too long", "warning"),
          violation("src/config.ts", 3, "clean-code.magic-numbers", "Magic number 42", "info")
        ],
        summary: summaryOf(3, 1, 1, 1, 3, 3),
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
          violation("src/api.ts", 42, "clean-code.deep-nesting", "Nesting depth 6 exceeds threshold 4", "warning", 15)
        ],
        summary: summaryOf(1, 0, 1, 0, 1, 1),
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
          violation("src/big.ts", 500, "clean-code.large-file", "File too large", "warning")
        ],
        summary: summaryOf(1, 0, 1, 0, 1, 1),
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
        summary: summaryOf(1, 0, 1, 0, 2, 2),
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
        summary: summaryOf(0, 0, 0, 0, 10, 5),
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
        summary: summaryOf(0, 0, 0, 0, 5, 3),
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
          violation("src/service.ts", 8, "solid.dip", "Direct instantiation detected", "error", 1)
        ],
        summary: summaryOf(1, 1, 0, 0, 1, 1),
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
        summary: summaryOf(0, 0, 0, 0, 1, 3),
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
          violation("src/auth.ts", 5, "solid.srp", "Multiple responsibilities", "error", 1)
        ],
        summary: summaryOf(1, 1, 0, 0, 1, 1),
        ...emptyResults(30),
      };

      const output = formatConsole(errorResult);

      expect(output).toContain('✗');
      expect(output).toContain('ERROR');
    });

    it('should show info severity with ℹ icon', () => {
      const infoResult: AnalysisResult = {
        violations: [
          violation("src/config.ts", 3, "clean-code.magic-numbers", "Magic number 42", "info", 10)
        ],
        summary: summaryOf(1, 0, 0, 1, 1, 1),
        ...emptyResults(20),
      };

      const output = formatConsole(infoResult);

      expect(output).toContain('ℹ');
      expect(output).toContain('INFO');
    });

    it('should handle violations without column number', () => {
      const noColumnResult: AnalysisResult = {
        violations: [
          violation("src/big.ts", 600, "clean-code.large-file", "File is too large: 600 lines (maximum: 500)", "warning")
        ],
        summary: summaryOf(1, 0, 1, 0, 1, 1),
        ...emptyResults(25),
      };

      const output = formatConsole(noColumnResult);

      expect(output).toContain('line 600');
      expect(output).not.toContain('col');
    });

    it('should include analysis errors only when violations exist', () => {
      const resultWithErrors: AnalysisResult = {
        violations: [
          violation("src/test.ts", 5, "clean-code.long-function", "Function too long", "warning", 1)
        ],
        summary: summaryOf(1, 0, 1, 0, 2, 1),
        ...emptyResults(50),
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
        summary: summaryOf(0, 0, 0, 0, 5, 3),
        ...emptyResults(50),
      };

      const output = formatConsole(emptyResult);

      expect(output).not.toContain('Analysis errors');
    });

    it('should show files checked in empty violations output', () => {
      const emptyResult: AnalysisResult = {
        violations: [],
        summary: summaryOf(0, 0, 0, 0, 15, 8),
        ...emptyResults(75),
      };

      const output = formatConsole(emptyResult);

      expect(output).toContain('Files checked: 15');
      expect(output).toContain('Rules run: 8');
      expect(output).toContain('75ms');
    });

    it('should include summary section with violation details', () => {
      const mixedResult: AnalysisResult = {
        violations: [
          violation("src/a.ts", 5, "solid.srp", "SRP violation", "error", 1),
          violation("src/b.ts", 10, "clean-code.long-function", "Too long", "warning")
        ],
        summary: summaryOf(2, 1, 1, 0, 2, 2),
        ...emptyResults(60),
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
        summary: summaryOf(0, 0, 0, 0, 5, 3),
        ...emptyResults(30),
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
        summary: summaryOf(1, 0, 1, 0, 3, 2),
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