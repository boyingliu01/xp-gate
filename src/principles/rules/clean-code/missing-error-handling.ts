import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';
import { extractFunctions, violationLineOf, severityOf, InspectedFunction } from './function-source';

/**
 * Whether this function does IO and has no try/catch anywhere in it.
 *
 * The absence is the finding: `hasTryCatch` is set by the adapter when the function
 * contains a try, so IO without it means the failure path is unhandled.
 */
function lacksErrorHandling(func: InspectedFunction): boolean {
  const doesIO = Boolean(func.ioOperations && func.ioOperations.length > 0);
  return doesIO && !func.hasTryCatch;
}

/**
 * Describe an IO-without-try/catch function.
 *
 * The operations are NAMED: "has IO operations" alone leaves the reader to find them,
 * and the point of the rule is to make the risk visible where it is declared.
 */
function describeViolation(
  file: string,
  func: InspectedFunction,
  severity: Violation['severity'],
): Violation {
  return {
    file,
    line: violationLineOf(func),
    ruleId: 'clean-code.missing-error-handling',
    message: `Function "${func.name}" has IO operations (${(func.ioOperations ?? []).join(', ')}) without error handling`,
    severity,
  };
}

export const missingErrorHandlingRule: Rule = {
  id: 'clean-code.missing-error-handling',
  name: 'Missing Error Handling Rule',
  threshold: 1,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['missing-error-handling'];
    const severity = severityOf(settings.severity, 'warning');
    return extractFunctions(adapter)
      .filter(lacksErrorHandling)
      .map((func) => describeViolation(file, func, severity));
  }
};
