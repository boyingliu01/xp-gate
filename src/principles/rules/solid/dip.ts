import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();
const { severity } = config.rules['solid']['dip'];
const EXCLUDED_CLASSES = config.rules['solid']['dip'].exclude || [
  'Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'
];

function shouldSkipInstantiation(className: string): boolean {
  if (EXCLUDED_CLASSES.includes(className)) return true;
  if (className.endsWith('Factory') || className.endsWith('Builder')) return true;
  return false;
}

export const dipRule: Rule = {
  id: 'solid.dip',
  name: 'Dependency Inversion Principle Rule',
  threshold: 0,
  severity: severity as 'error' | 'warning' | 'info',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];

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
            severity: severity as 'error' | 'warning' | 'info',
            message: `Direct instantiation detected: new ${className}(). Prefer dependency injection for flexibility.`,
          });
        }
      }
    } catch { }
    return violations;
  }
};