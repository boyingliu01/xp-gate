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
  check: checkDeepNesting,
};

/**
 * Every function that nests deeper than the ceiling.
 *
 * Collected with `flatMap` so a function that does not violate contributes nothing --
 * `nestingViolation` returns null for those, and the shape says so.
 */
function checkDeepNesting(file: string, adapter: unknown): Violation[] {
  // Read the ACTIVE config per invocation; a module-load snapshot was #457.
  const settings = getActiveConfig().rules['clean-code']['deep-nesting'];
  // The RULE's own default, not 0. `?? 0` is unreachable today -- `getActiveConfig()`
  // merges the defaults in -- but if that ever stopped holding, every function with one
  // nested block would be reported and the gate would become noise. Falling back to the
  // declared threshold keeps the worst case "unchanged" instead of "everything violates"
  // (review MC-02).
  const maxDepth = settings.threshold ?? deepNestingRule.threshold ?? 4;
  const severity = (settings.severity as Severity) ?? 'warning';
  const functions = (adapter as TypedAdapter).extractFunctions?.() || [];
  return functions
    .map((func) => nestingViolation(func, maxDepth, file, severity))
    .filter((found): found is Violation => found !== null);
}
