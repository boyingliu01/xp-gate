import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

/** One function as the adapter reports it. */
interface FunctionFacts {
  name?: string;
  nestingDepth?: number;
  startLine?: number;
  line?: number;
}

/** The shape of the adapter we consult. */
interface TypedAdapter {
  extractFunctions?: () => FunctionFacts[] | undefined;
}

/** A violation when one function nests deeper than the threshold, else null. */
function nestingViolation(
  func: FunctionFacts, maxDepth: number, file: string, severity: Severity,
): Violation | null {
  const depth = func.nestingDepth;
  if (!depth || depth <= maxDepth) return null;
  return {
    file,
    line: func.startLine ?? func.line ?? 1,
    ruleId: 'clean-code.deep-nesting',
    severity,
    message: `Function "${func.name}" has deep nesting: ${depth} levels (maximum: ${maxDepth})`,
  };
}

export const deepNestingRule: Rule = {
  id: 'clean-code.deep-nesting',
  name: 'Deep Nesting Rule',
  threshold: 4,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['deep-nesting'];
    const maxDepth = settings.threshold ?? 0;
    const severity = (settings.severity as Severity) ?? 'warning';

    const violations: Violation[] = [];
    for (const func of (adapter as TypedAdapter).extractFunctions?.() || []) {
      const found = nestingViolation(func, maxDepth, file, severity);
      if (found) violations.push(found);
    }
    return violations;
  }
};
