import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const longFunctionRule: Rule = {
  id: 'clean-code.long-function',
  name: 'Long Function Rule',
  threshold: config.rules['clean-code']['long-function'].threshold ?? 50,
  severity: config.rules['clean-code']['long-function'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions() || [];
      
      for (const func of functions) {
        const { name, startLine, length } = func;
        
        if (length > (config.rules['clean-code']['long-function'].threshold as number)) {
          violations.push({
            file,
            line: startLine,
            ruleId: 'clean-code.long-function',
            message: `Function "${name}" is too long: ${length} lines (maximum: ${
              config.rules['clean-code']['long-function'].threshold
            })`,
            severity: config.rules['clean-code']['long-function'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};