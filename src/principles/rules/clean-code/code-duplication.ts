import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const codeDuplicationRule: Rule = {
  id: 'clean-code.code-duplication',
  name: 'Code Duplication Rule',
  threshold: 15,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['code-duplication'];
    
    try {
      const typedAdapter = adapter as { duplicationPercentage?: number };
      const duplicationPercentage = typedAdapter.duplicationPercentage;
      
      if (duplicationPercentage && duplicationPercentage > (settings.threshold ?? 0)) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.code-duplication',
          message: `Code duplication detected: ${duplicationPercentage}% (threshold: ${settings.threshold}%). Consider refactoring duplicated code.`,
          severity: (settings.severity as Severity) ?? 'warning'
        });
      }
    } catch { }
    
    return violations;
  }
};