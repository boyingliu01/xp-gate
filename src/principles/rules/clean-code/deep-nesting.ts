import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const deepNestingRule: Rule = {
  id: 'clean-code.deep-nesting',
  name: 'Deep Nesting Rule',
  threshold: config.rules['clean-code']['deep-nesting'].threshold ?? 4,
  severity: config.rules['clean-code']['deep-nesting'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions() || [];
      
      for (const func of functions) {
        if (func.nestingDepth && func.nestingDepth > (config.rules['clean-code']['deep-nesting'].threshold as number)) {
          violations.push({
            file,
            line: func.startLine || func.line,
            ruleId: 'clean-code.deep-nesting',
            message: `Function "${func.name}" has deep nesting: ${func.nestingDepth} levels (maximum: ${
              config.rules['clean-code']['deep-nesting'].threshold
            })`,
            severity: config.rules['clean-code']['deep-nesting'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};