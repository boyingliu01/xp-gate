import { AnalysisResult, Violation } from './analyzer';

export interface ReporterOutput {
  console: string;
  json: string;
  summary: string;
  sarif: string;
}

export function formatSARIF(result: AnalysisResult): string {
  const ruleDescriptors = Object.keys(result.ruleResults).map(ruleId => ({
    id: ruleId,
    shortDescription: {
      text: getRuleDescription(ruleId)
    },
    defaultConfiguration: {
      level: getRuleLevel(ruleId)
    }
  }));
  
  const sarifResults = result.violations.map(v => ({
    ruleId: v.ruleId,
    level: v.severity === 'error' ? 'error' : v.severity === 'warning' ? 'warning' : 'note',
    message: {
      text: v.message
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: v.file
          },
          region: {
            startLine: v.line,
            startColumn: v.column || 1
          }
        }
      }
    ]
  }));
  
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Principles Checker',
            version: '1.0.0',
            informationUri: 'https://github.com/boyingliu01/xp-workflow-automation',
            rules: ruleDescriptors
          }
        },
        results: sarifResults,
        properties: {
          filesChecked: result.summary.filesChecked,
          rulesRun: result.summary.rulesRun,
          executionTimeMs: result.executionTimeMs
        }
      }
    ]
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
    'solid.dip': 'Dependency Inversion Principle violation'
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

export function formatConsole(result: AnalysisResult): string {
  const lines: string[] = [];
  
  if (result.violations.length === 0) {
    lines.push('✓ No violations found');
    lines.push('');
    lines.push(`Files checked: ${result.summary.filesChecked}`);
    lines.push(`Rules run: ${result.summary.rulesRun}`);
    lines.push(`Execution time: ${result.executionTimeMs}ms`);
    return lines.join('\n');
  }
  
  const filesMap: Record<string, Violation[]> = {};
  for (const v of result.violations) {
    if (!filesMap[v.file]) {
      filesMap[v.file] = [];
    }
    filesMap[v.file].push(v);
  }
  
  for (const [file, violations] of Object.entries(filesMap)) {
    lines.push(`\n📁 ${file}`);
    lines.push('─'.repeat(40));
    
    for (const v of violations) {
      const severityIcon = v.severity === 'error' ? '✗' : 
                           v.severity === 'warning' ? '⚠' : 'ℹ';
      const severityLabel = v.severity.toUpperCase();
      
      lines.push(`  ${severityIcon} [${severityLabel}] ${v.ruleId}`);
      lines.push(`     line ${v.line}${v.column ? `, col ${v.column}` : ''}: ${v.message}`);
    }
  }
  
  lines.push('');
  lines.push('─'.repeat(40));
  lines.push(formatSummary(result));
  lines.push(`Execution time: ${result.executionTimeMs}ms`);
  
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('⚠ Analysis errors:');
    for (const err of result.errors) {
      lines.push(`  - ${err}`);
    }
  }
  
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

export function formatSummary(result: AnalysisResult): string {
  const status = result.violations.length === 0 ? 'PASS' : 'FAIL';
  const statusIcon = result.violations.length === 0 ? '✓' : '✗';
  
  const lines: string[] = [];
  lines.push(`${statusIcon} ${status}`);
  lines.push('');
  lines.push(`${result.summary.totalViolations} violations total`);
  lines.push(`  ${result.summary.errorCount} errors`);
  lines.push(`  ${result.summary.warningCount} warnings`);
  lines.push(`  ${result.summary.infoCount} info`);
  lines.push('');
  lines.push(`${result.summary.filesChecked} files checked`);
  lines.push(`${result.summary.rulesRun} rules run`);
  
  return lines.join('\n');
}