import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const missingErrorHandlingRule: Rule = {
  id: 'clean-code.missing-error-handling',
  name: 'Missing Error Handling Rule',
  threshold: 1,
  severity: config.rules['clean-code']['missing-error-handling'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions() || [];
      
      for (const func of functions) {
        if (func.ioOperations && func.ioOperations.length > 0 && !func.hasTryCatch) {
          violations.push({
            file,
            line: func.startLine || func.line,
            ruleId: 'clean-code.missing-error-handling',
            message: `Function "${func.name}" has IO operations (${func.ioOperations.join(', ')}) without error handling`,
            severity: config.rules['clean-code']['missing-error-handling'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};