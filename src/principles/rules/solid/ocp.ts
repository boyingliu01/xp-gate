import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';

/** The base class named in `extends X`, or null when the class extends nothing. */
function baseClassOf(code: string): string | null {
  const match = code.match(/extends\s+(\w+)/);
  return match ? match[1] : null;
}

/**
 * OCP is violated when a class, in the same body, both extends a base class and
 * redeclares it — a local extension that had to reach back into the base.
 */
function ocpViolation(
  code: string, name: string | undefined, line: number, file: string,
  severity: 'error' | 'warning' | 'info',
): Violation | null {
  const baseClass = baseClassOf(code);
  if (baseClass === null) return null;
  if (!code.includes(`class ${baseClass}`)) return null;
  return {
    file,
    line,
    ruleId: 'solid.ocp',
    message: `Possible modification of base class "${baseClass}" while extending. Extension should not require modifying the base.`,
    severity,
  };
}

export const ocpRule: Rule = {
  id: 'solid.ocp',
  name: 'Open/Closed Principle Rule',
  threshold: 0,
  severity: 'info',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] =>
    checkOcp(file, adapter, readOcpSeverity()),
}

/** The severity the ACTIVE config declares for this rule. */
function readOcpSeverity(): 'error' | 'warning' | 'info' {
  // Read per invocation; a module-load snapshot was #457.
  const settings = getActiveConfig().rules.solid.ocp;
  return (settings.severity as 'error' | 'warning' | 'info') ?? 'info';
}

/**
 * Every OCP violation in one file.
 *
 * A class with no source is skipped rather than reported: the rule needs the body to see
 * the base-class redeclaration, so an empty one would produce a confident false negative.
 */
function checkOcp(
  file: string,
  adapter: import('../../types').Adapter,
  severity: 'error' | 'warning' | 'info',
): Violation[] {
  const violations: Violation[] = [];
  for (const raw of adapter.extractClasses() || []) {
    const cls = raw as { code?: string; line?: number; name?: string };
    if (!cls.code) continue;
    const found = ocpViolation(cls.code, cls.name, cls.line ?? 1, file, severity);
    if (found) violations.push(found);
  }
  return violations;
}
