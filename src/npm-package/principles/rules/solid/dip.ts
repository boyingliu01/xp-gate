import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

const DEFAULT_EXCLUDED_CLASSES = [
  'Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'
];

/**
 * Read the excluded list from the ACTIVE config on each call.
 *
 * A module-load snapshot was #457: a project's `.principlesrc` override was
 * parsed but never consulted.
 */
function excludedClasses(): (string | number)[] {
  return getActiveConfig().rules['solid']['dip'].exclude ?? DEFAULT_EXCLUDED_CLASSES;
}

function shouldSkipInstantiation(className: string): boolean {
  if (excludedClasses().includes(className)) return true;
  if (className.endsWith('Factory') || className.endsWith('Builder')) return true;
  return false;
}

/** `new Foo(` -> `Foo`. */
function classNameFromNewMatch(match: string): string {
  return match.replace(/new\s+/, '').replace(/\s*\(/, '');
}

/** Violations for one class body: each `new X(` that is not exempt. */
function instantiationViolations(
  code: string, line: number, file: string, severity: Severity,
): Violation[] {
  const violations: Violation[] = [];
  for (const match of code.match(/new\s+(\w+)\s*\(/g) || []) {
    const className = classNameFromNewMatch(match);
    if (shouldSkipInstantiation(className)) continue;
    violations.push({
      file,
      line,
      ruleId: 'solid.dip',
      severity,
      message: `Direct instantiation detected: new ${className}(). Prefer dependency injection for flexibility.`,
    });
  }
  return violations;
}

export const dipRule: Rule = {
  id: 'solid.dip',
  name: 'Dependency Inversion Principle Rule',
  threshold: 0,
  severity: 'warning',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const settings = getActiveConfig().rules['solid']['dip'];
    const severity = (settings.severity as Severity) ?? 'warning';

    const violations: Violation[] = [];
    for (const clsAny of adapter.extractClasses() || []) {
      const cls = clsAny as { code?: string; line?: number };
      if (!cls.code) continue;
      violations.push(...instantiationViolations(cls.code, cls.line || 0, file, severity));
    }
    return violations;
  }
};
