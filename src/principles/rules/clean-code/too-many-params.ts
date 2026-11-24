import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';
import { extractFunctions, violationLineOf, severityOf, InspectedFunction } from '../function-source';

/**
 * Whether this function exceeds the configured parameter budget.
 *
 * `paramCount` is checked for TRUTHINESS before the comparison, so an adapter that
 * does not report the field contributes nothing. A count of 0 is not a violation and
 * must not fall through to `undefined > n`.
 */
function exceedsBudget(func: InspectedFunction, threshold: number): boolean {
  return Boolean(func.paramCount) && (func.paramCount as number) > threshold;
}

/**
 * Describe an over-budget function.
 *
 * The message names the count AND the budget: "too many parameters" alone leaves the
 * reader to work out which number is wrong, and the remedy differs -- reduce the count,
 * or raise the threshold if the signature is deliberate.
 */
function describeViolation(
  file: string,
  func: InspectedFunction,
  threshold: number,
  severity: Violation['severity'],
): Violation {
  return {
    file,
    line: violationLineOf(func),
    ruleId: 'clean-code.too-many-params',
    message: `Function "${func.name}" has too many parameters: ${func.paramCount} (maximum: ${threshold})`,
    severity,
  };
}

export const tooManyParamsRule: Rule = {
  id: 'clean-code.too-many-params',
  name: 'Too Many Parameters Rule',
  threshold: 7,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['too-many-params'];
    const threshold = settings.threshold ?? 0;
    const severity = severityOf(settings.severity, 'info');
    return extractFunctions(adapter)
      .filter((func) => exceedsBudget(func, threshold))
      .map((func) => describeViolation(file, func, threshold, severity));
  }
};
