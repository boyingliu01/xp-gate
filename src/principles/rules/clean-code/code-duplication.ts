import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const codeDuplicationRule: Rule = {
  id: 'clean-code.code-duplication',
  name: 'Code Duplication Rule',
  threshold: config.rules['clean-code']['code-duplication'].threshold ?? 15,
  severity: config.rules['clean-code']['code-duplication'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const duplicationPercentage = adapter.duplicationPercentage;
      
      if (duplicationPercentage && duplicationPercentage > (config.rules['clean-code']['code-duplication'].threshold as number)) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.code-duplication',
          message: `Code duplication detected: ${duplicationPercentage}% (threshold: ${config.rules['clean-code']['code-duplication'].threshold}%). Consider refactoring duplicated code.`,
          severity: config.rules['clean-code']['code-duplication'].severity as any
        });
      }
    } catch (error) {
    }
    
    return violations;
  }
};