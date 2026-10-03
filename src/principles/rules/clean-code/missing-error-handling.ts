import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const missingErrorHandlingRule: Rule = {
  id: 'clean-code.missing-error-handling',
  name: 'Missing Error Handling Rule',
  threshold: 1,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['missing-error-handling'];
    
    try {
      const typedAdapter = adapter as { extractFunctions?: () => Array<{name?: string; startLine?: number; line?: number; ioOperations?: string[]; hasTryCatch?: boolean;}> | undefined };
      const functions = typedAdapter.extractFunctions?.() || [];
      
      for (const func of functions) {
        if (func.ioOperations && func.ioOperations.length > 0 && !func.hasTryCatch) {
          violations.push({
            file,
            line: func.startLine ?? func.line ?? 1,
            ruleId: 'clean-code.missing-error-handling',
            message: `Function "${func.name}" has IO operations (${func.ioOperations.join(', ')}) without error handling`,
            severity: (settings.severity as Severity) ?? 'warning'
          });
        }
      }
    } catch { }
    
    return violations;
  }
};