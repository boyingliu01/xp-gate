import chalk from 'chalk';
import { Violation, Config } from './types.js';

/**
 * Clean Code & SOLID Principles Checker
 * Reporter module to display analysis results in console.
 * 
 * This module handles formatting and output of violations found during analysis,
 * with colored console output to distinguish by severity and category.
 */

/**
 * Generates and outputs a report based on violations found during analysis
 * @param violations Array of violations found during analysis
 * @param config Configuration used for the analysis
 * @param hasViolations Boolean indicating if there were violations (affects exit code)
 */
export function generateReport(violations: Violation[], config: Config, hasViolations: boolean) {
  if (!hasViolations) {
    console.log(chalk.green('✓ No violations found. Your code follows the defined principles.'));
    console.log('\nSummary:');
    console.log(`- Files analyzed: ${0}`); // We would need to pass this information to make this accurate
    console.log(`- Violations found: ${violations.length}`);
    return;
  }

  // Group violations by severity for clear reporting
  const errorViolations = violations.filter(violation => violation.severity === 'error');
  const warningViolations = violations.filter(violation => violation.severity === 'warning');
  const infoViolations = violations.filter(violation => violation.severity === 'info');

  console.log(chalk.red.bold(`✗ ${errorViolations.length} error(s)`));
  console.log(chalk.yellow.bold(`⚠ ${warningViolations.length} warning(s)`));
  console.log(chalk.blue.bold(`ℹ ${infoViolations.length} info message(s)`));
  console.log('');

  // Organize by file
  const violationsByFile = groupViolationsByFile(violations);
  
  for (const [file, fileViolations] of violationsByFile.entries()) {
    console.log(chalk.underline(file));
    
    for (const violation of fileViolations) {
      const severityColor = getSeverityColor(violation.severity);
      
      let lineIndicator = '';
      if (violation.line) {
        lineIndicator = `:${violation.line}`;
        if (violation.column) {
          lineIndicator += `:${violation.column}`;
        }
      }
      
      console.log(
        `  ${severityColor(violation.severity.toUpperCase())} ${chalk.gray(`${violation.ruleId}${lineIndicator}`)}`
      );
      console.log(`    ${chalk.white(violation.message)}`);
      if (violation.snippet) {
        console.log(`    ${chalk.gray(truncateSnippet(violation.snippet))}`);
      }
      console.log('');
    }
  }

  // Summary at the end
  console.log(chalk.bold('SUMMARY'));
  console.log('=======');
  console.log(`- Total violations found: ${violations.length}`);
  console.log(`- Errors: ${errorViolations.length}`);
  console.log(`- Warnings: ${warningViolations.length}`);
  console.log(`- Info: ${infoViolations.length}`);
  console.log('');
  
  if (errorViolations.length > 0) {
    console.log(chalk.red('There were errors that need to be fixed before proceeding.'));
  }
  if (warningViolations.length > 0) {
    console.log(chalk.yellow('There were warnings that should be reviewed.'));  
  }
  if (infoViolations.length > 0) {
    console.log(chalk.blue('There were informational messages about your code.'));
  }

  console.log('');
  console.log('To adjust the strictness of the checks, consider updating your .principlesrc file.');
}

/**
 * Groups violations by file path for organized display
 */
function groupViolationsByFile(violations: Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  
  for (const violation of violations) {
    if (!map.has(violation.file)) {
      map.set(violation.file, []);
    }
    map.get(violation.file)!.push(violation);
  }
  
  return map;
}

/**
 * Gets the appropriate chalk color function for a severity level
 */
function getSeverityColor(severity: string) {
  switch (severity) {
    case 'error':
      return chalk.red;
    case 'warning':
      return chalk.yellow;
    case 'info':
      return chalk.blue;
    default:
      return chalk.white;
  }
}

/**
 * Truncates snippet to single line for cleaner console output
 */
function truncateSnippet(snippet: string): string {
  if (!snippet) return '';
  
  // Take only the first line of the snippet and trim to prevent overly long lines
  let firstLine = snippet.trim().split('\n')[0];
  if (firstLine.length > 100) {
    return firstLine.substring(0, 100) + '...';
  }
  return firstLine;
}

/**
 * Returns exit code based on whether violations were found
 * This function is called by the main CLI entry point
 */
export function getExitCode(violations: Violation[]): number {
  // If there are any errors, return non-zero exit code
  const hasErrors = violations.some(v => v.severity === 'error');
  return hasErrors ? 1 : 0;
}