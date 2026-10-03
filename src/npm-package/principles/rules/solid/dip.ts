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

export const dipRule: Rule = {
  id: 'solid.dip',
  name: 'Dependency Inversion Principle Rule',
  threshold: 0,
  severity: 'warning',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];
    const settings = getActiveConfig().rules['solid']['dip'];
    const severity = (settings.severity as Severity) ?? 'warning';

    try {
      for (const cls_any of adapter.extractClasses() || []) {
        const cls = cls_any as {code?: string; line?: number};
        const code = cls.code;
        if (!code) continue;

        const newMatches = code.match(/new\s+(\w+)\s*\(/g) || [];
        for (const match of newMatches) {
          const className = match.replace(/new\s+/, '').replace(/\s*\(/, '');
          if (shouldSkipInstantiation(className)) continue;

          violations.push({
            file,
            line: cls.line || 0,
            ruleId: 'solid.dip',
            severity,
            message: `Direct instantiation detected: new ${className}(). Prefer dependency injection for flexibility.`,
          });
        }
      }
    } catch { }
    return violations;
  }
};