import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const longFunctionRule: Rule = {
  id: 'clean-code.long-function',
  name: 'Long Function Rule',
  threshold: 50,
  severity: 'warning',
  check: checkLongFunctions,
};

/** One function as the adapter reports it. */
interface FunctionObj {
  name: string;
  startLine: number;
  length: number;
}

/** The part of an adapter this rule consumes. */
interface TypedAdapter {
  extractFunctions?: () => FunctionObj[] | undefined;
}

/** The functions the adapter reports, or none when it cannot report any. */
function extractFunctions(adapter: unknown): FunctionObj[] {
  return (adapter as TypedAdapter).extractFunctions?.() || [];
}

/**
 * Every over-long function in one file.
 *
 * `startLine ?? 1` because an adapter may not track positions; the violation still names
 * the FUNCTION, and dropping it over a missing line would lose a real finding.
 */
function checkLongFunctions(file: string, adapter: unknown): Violation[] {
  // Read the ACTIVE config per invocation; a module-load snapshot was #457.
  const settings = getActiveConfig().rules['clean-code']['long-function'];
  const threshold = settings.threshold ?? 0;
  return extractFunctions(adapter)
    .filter((func) => func.length > threshold)
    .map((func) => violationFor(func, file, settings, threshold));
}

/** The violation for one over-long function. */
function violationFor(
  func: FunctionObj,
  file: string,
  settings: { severity?: string },
  threshold: number,
): Violation {
  return {
    file,
    line: func.startLine ?? 1,
    ruleId: 'clean-code.long-function',
    message: `Function "${func.name}" is too long: ${func.length} lines (maximum: ${threshold})`,
    severity: (settings.severity as Severity) ?? 'warning',
  };
}