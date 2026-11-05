import { AnalysisResult, AnalysisSummary, Violation } from './analyzer';

/** Width of the horizontal rule that separates file blocks in console output. */
const CONSOLE_RULE_WIDTH = 40;

/** SARIF severity for a violation. SARIF calls `info` a "note". */
function toSarifLevel(severity: Violation['severity']): string {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'note';
}

/** Map one violation to its SARIF result entry. */
function toSarifResult(v: Violation): Record<string, unknown> {
  const region = { startLine: v.line, startColumn: v.column || 1 };
  const physicalLocation = { artifactLocation: { uri: v.file }, region };
  return {
    ruleId: v.ruleId,
    level: toSarifLevel(v.severity),
    message: { text: v.message },
    locations: [{ physicalLocation }],
  };
}

/** The `runs[0]` object: tool driver metadata plus every result. */
function buildSarifRun(result: AnalysisResult): Record<string, unknown> {
  const ruleDescriptors = Object.keys(result.ruleResults).map(ruleId => ({
    id: ruleId,
    shortDescription: { text: getRuleDescription(ruleId) },
    defaultConfiguration: { level: getRuleLevel(ruleId) },
  }));

  return {
    tool: {
      driver: {
        name: 'Principles Checker',
        version: '1.0.0',
        informationUri: 'https://github.com/boyingliu01/xp-gate',
        rules: ruleDescriptors,
      },
    },
    results: result.violations.map(toSarifResult),
    properties: {
      filesChecked: result.summary.filesChecked,
      rulesRun: result.summary.rulesRun,
      executionTimeMs: result.executionTimeMs,
    },
  };
}

export function formatSARIF(result: AnalysisResult): string {
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [buildSarifRun(result)],
  };

  return JSON.stringify(sarif, null, 2);
}

function getRuleDescription(ruleId: string): string {
  const descriptions: Record<string, string> = {
    'clean-code.long-function': 'Function exceeds maximum line threshold',
    'clean-code.large-file': 'File exceeds maximum line threshold',
    'clean-code.god-class': 'Class has too many methods',
    'clean-code.deep-nesting': 'Nested depth exceeds threshold',
    'clean-code.too-many-params': 'Function has too many parameters',
    'clean-code.magic-numbers': 'Magic number found without named constant',
    'clean-code.missing-error-handling': 'Missing error handling for I/O operations',
    'clean-code.unused-imports': 'Unused import detected',
    'clean-code.code-duplication': 'Code duplication detected',
    'solid.srp': 'Single Responsibility Principle violation',
    'solid.ocp': 'Open/Closed Principle violation',
    'solid.lsp': 'Liskov Substitution Principle violation',
    'solid.isp': 'Interface Segregation Principle violation',
    'solid.dip': 'Dependency Inversion Principle violation',
    'arch.controller': 'Class in interfaces/rest must be named *Controller',
    'arch.service': 'Class in application/service must be named *Service or *ServiceImpl',
    'arch.repository': 'Class in infrastructure must be named *Mapper, *DAO or *Repository',
    'arch.dto-layering': 'DTO must not depend on a service or repository',
    'arch.domain-event': 'Domain event must not depend on the infrastructure layer',
    'arch.util-service': 'Utility depends on an application service'
  };
  
  return descriptions[ruleId] || ruleId;
}

function getRuleLevel(ruleId: string): string {
  const errorRules = ['clean-code.missing-error-handling', 'solid.srp', 'solid.dip'];
  const warningRules = [
    'clean-code.long-function', 'clean-code.large-file', 'clean-code.god-class',
    'clean-code.deep-nesting', 'clean-code.code-duplication'
  ];
  
  if (errorRules.includes(ruleId)) return 'error';
  if (warningRules.includes(ruleId)) return 'warning';
  return 'note';
}

function formatEmptyResult(result: AnalysisResult, lines: string[]): string {
  lines.push('✓ No violations found');
  lines.push('');
  lines.push(`Files checked: ${result.summary.filesChecked}`);
  lines.push(`Rules run: ${result.summary.rulesRun}`);
  lines.push(`Execution time: ${result.executionTimeMs}ms`);
  return lines.join('\n');
}

function formatViolationLines(violation: Violation): string[] {
  const severityIcon = violation.severity === 'error' ? '✗' : 
                       violation.severity === 'warning' ? '⚠' : 'ℹ';
  const severityLabel = violation.severity.toUpperCase();
  return [
    `  ${severityIcon} [${severityLabel}] ${violation.ruleId}`,
    `     line ${violation.line}${violation.column ? `, col ${violation.column}` : ''}: ${violation.message}`
  ];
}

function formatFileViolations(lines: string[], filesMap: Record<string, Violation[]>): void {
  for (const [file, violations] of Object.entries(filesMap)) {
    lines.push(`\n📁 ${file}`);
    lines.push('─'.repeat(CONSOLE_RULE_WIDTH));
    for (const v of violations) {
      lines.push(...formatViolationLines(v));
    }
  }
}

function formatErrors(lines: string[], result: AnalysisResult): void {
  if (result.errors.length === 0) return;
  lines.push('');
  lines.push('⚠ Analysis errors:');
  for (const err of result.errors) {
    lines.push(`  - ${err}`);
  }
}

export function formatConsole(result: AnalysisResult): string {
  const lines: string[] = [];
  
  if (result.violations.length === 0) {
    return formatEmptyResult(result, lines);
  }
  
  const filesMap: Record<string, Violation[]> = {};
  for (const v of result.violations) {
    if (!filesMap[v.file]) {
      filesMap[v.file] = [];
    }
    filesMap[v.file].push(v);
  }
  
  formatFileViolations(lines, filesMap);
  
  lines.push('');
  lines.push('─'.repeat(CONSOLE_RULE_WIDTH));
  lines.push(formatSummary(result));
  lines.push(`Execution time: ${result.executionTimeMs}ms`);
  
  formatErrors(lines, result);
  
  return lines.join('\n');
}

export function formatJSON(result: AnalysisResult): string {
  const output = {
    violations: result.violations,
    summary: result.summary,
    fileResults: result.fileResults,
    ruleResults: result.ruleResults,
    executionTimeMs: result.executionTimeMs,
    errors: result.errors
  };
  
  return JSON.stringify(output, null, 2);
}

/**
 * A summary field read defensively, with every substitution recorded.
 *
 * `formatSummary` is exported, so it cannot assume its caller honoured the
 * AnalysisResult type: a missing summary used to throw, and a partial one
 * computed `undefined + 0 = NaN` -- where `NaN === 0` is false, so every commit
 * reported FAIL forever. Zeroing alone is not enough either; it would turn a
 * corrupted summary into "nothing to report", so each substitution is named.
 */
function readCounts(summary: AnalysisSummary | undefined, damaged: string[]): number[] {
  const fields: Array<keyof AnalysisSummary> = [
    'totalViolations', 'errorCount', 'warningCount', 'infoCount', 'filesChecked', 'rulesRun',
  ];
  return fields.map((field) => {
    const value = summary?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    damaged.push(`${field}=${String(value)}`);
    return 0;
  });
}

export function formatSummary(result: AnalysisResult): string {
  // `info` is "log only" (AGENTS.md). Counting it as a failure turned every
  // rule's way of saying "I could not judge this file" into a blocked commit --
  // the arch layout diagnostic surfaced exactly that. Only error and warning
  // are blocking severities, so PASS/FAIL reads from those two alone.
  const damaged: string[] = [];
  const [total, errors, warnings, info, files, rules] = readCounts(result.summary, damaged);
  const pass = errors + warnings === 0;
  const lines = [
    pass ? 'PASS' : 'FAIL',
    '',
    `${total} violations total`,
    `  ${errors} errors`,
    `  ${warnings} warnings`,
    `  ${info} info`,
    '',
    `${files} files checked`,
    `${rules} rules run`,
  ];
  if (damaged.length > 0) {
    lines.push('', `! malformed summary: ${damaged.join(', ')} (read as 0; the counts above cannot be trusted)`);
  }
  return lines.join('\n');
}