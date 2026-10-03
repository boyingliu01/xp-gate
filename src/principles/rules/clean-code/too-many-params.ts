import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const tooManyParamsRule: Rule = {
  id: 'clean-code.too-many-params',
  name: 'Too Many Parameters Rule',
  threshold: 7,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['too-many-params'];
    
    try {
      const typedAdapter = adapter as { extractFunctions?: () => Array<{name?: string; startLine?: number; line?: number; paramCount?: number;}> | undefined };
      const functions = typedAdapter.extractFunctions?.() || [];
      
      for (const func of functions) {
        if (func.paramCount && func.paramCount > (settings.threshold ?? 0)) {
          violations.push({
            file,
            line: func.startLine ?? func.line ?? 1,
            ruleId: 'clean-code.too-many-params',
            message: `Function "${func.name}" has too many parameters: ${func.paramCount} (maximum: ${
              settings.threshold
            })`,
            severity: (settings.severity as Severity) ?? 'info'
          });
        }
      }
    } catch { }
    
    return violations;
  }
};