import { AnalysisResult, Violation } from './analyzer';

export interface ReporterOutput {
  console: string;
  json: string;
  summary: string;
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