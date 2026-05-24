import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const codeDuplicationRule: Rule = {
  id: 'clean-code.code-duplication',
  name: 'Code Duplication Rule',
  threshold: config.rules['clean-code']['code-duplication'].threshold ?? 15,
  severity: config.rules['clean-code']['code-duplication'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const typedAdapter = adapter as { duplicationPercentage?: number };
      const duplicationPercentage = typedAdapter.duplicationPercentage;
      
      if (duplicationPercentage && duplicationPercentage > (config.rules['clean-code']['code-duplication'].threshold as number)) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.code-duplication',
          message: `Code duplication detected: ${duplicationPercentage}% (threshold: ${config.rules['clean-code']['code-duplication'].threshold}%). Consider refactoring duplicated code.`,
          severity: config.rules['clean-code']['code-duplication'].severity as Severity
        });
      }
    } catch { }
    
    return violations;
  }
};