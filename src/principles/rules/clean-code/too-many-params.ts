import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const tooManyParamsRule: Rule = {
  id: 'clean-code.too-many-params',
  name: 'Too Many Parameters Rule',
  threshold: config.rules['clean-code']['too-many-params'].threshold ?? 7,
  severity: config.rules['clean-code']['too-many-params'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions() || [];
      
      for (const func of functions) {
        if (func.paramCount && func.paramCount > (config.rules['clean-code']['too-many-params'].threshold as number)) {
          violations.push({
            file,
            line: func.startLine || func.line,
            ruleId: 'clean-code.too-many-params',
            message: `Function "${func.name}" has too many parameters: ${func.paramCount} (maximum: ${
              config.rules['clean-code']['too-many-params'].threshold
            })`,
            severity: config.rules['clean-code']['too-many-params'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};