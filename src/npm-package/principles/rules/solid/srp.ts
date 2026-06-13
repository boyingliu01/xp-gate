import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();
const { methodThreshold, severity } = config.rules['solid']['srp'];

export const srpRule: Rule = {
  id: 'solid.srp',
  name: 'Single Responsibility Principle Rule',
  threshold: methodThreshold as number,
  severity: severity as "error" | "warning" | "info",
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];

    try {
      const classes = adapter.extractClasses() || [];
      const maxMethods = methodThreshold as number;
      const sev = severity as "error" | "warning" | "info";

      for (const raw of classes) {
        const cls = raw as { code?: string; line?: number; name?: string; methodCount?: number; imports?: Record<string, unknown> };
        const methodCount = cls.methodCount || 0;
        const importCategories = cls.imports ? Object.keys(cls.imports).length : 0;
        const line = cls.line ?? 1;

        if (methodCount > maxMethods) {
          violations.push({
            file, line, ruleId: 'solid.srp', severity: sev,
            message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${maxMethods}). Consider splitting into focused classes.`,
          });
        }

        if (importCategories > 3) {
          violations.push({
            file, line, ruleId: 'solid.srp', severity: sev,
            message: `Class "${cls.name}" imports from ${importCategories} different domains. Each class should focus on one responsibility.`,
          });
        }
      }
    } catch { }

    return violations;
  },
};