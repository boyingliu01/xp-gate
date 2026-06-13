import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const longFunctionRule: Rule = {
  id: 'clean-code.long-function',
  name: 'Long Function Rule',
  threshold: config.rules['clean-code']['long-function'].threshold ?? 50,
  severity: config.rules['clean-code']['long-function'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
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
        
        if (length > (config.rules['clean-code']['long-function'].threshold as number)) {
          violations.push({
            file,
            line: startLine ?? 1,
            ruleId: 'clean-code.long-function',
            message: `Function "${name}" is too long: ${length} lines (maximum: ${
              config.rules['clean-code']['long-function'].threshold
            })`,
            severity: config.rules['clean-code']['long-function'].severity as Severity
          });
        }
      }
    } catch { }
    
    return violations;
  }
};