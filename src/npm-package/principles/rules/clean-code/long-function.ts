import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const longFunctionRule: Rule = {
  id: 'clean-code.long-function',
  name: 'Long Function Rule',
  threshold: 50,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['long-function'];
    
    try {
      interface FunctionObj {
        name: string;
        startLine: number;
        length: number;
      }
      
      interface TypedAdapter {
        extractFunctions?: () => FunctionObj[] | undefined;
      }
      
      const typedAdapter = adapter as TypedAdapter;
      const functions = typedAdapter.extractFunctions?.() || [];
      
      for (const func of functions) {
        const { name, startLine, length } = func;
        
        if (length > (settings.threshold ?? 0)) {
          violations.push({
            file,
            line: startLine ?? 1,
            ruleId: 'clean-code.long-function',
            message: `Function "${name}" is too long: ${length} lines (maximum: ${
              settings.threshold
            })`,
            severity: (settings.severity as Severity) ?? 'warning'
          });
        }
      }
    } catch { }
    
    return violations;
  }
};