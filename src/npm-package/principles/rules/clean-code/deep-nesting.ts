import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const deepNestingRule: Rule = {
  id: 'clean-code.deep-nesting',
  name: 'Deep Nesting Rule',
  threshold: config.rules['clean-code']['deep-nesting'].threshold ?? 4,
  severity: config.rules['clean-code']['deep-nesting'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      interface TypedAdapter {
        extractFunctions?: () => Array<{name?: string, nestingDepth?: number, startLine?: number, line?: number}> | undefined;
      }
      const typedAdapter = adapter as TypedAdapter;
      const functions = typedAdapter.extractFunctions?.() || [];
      
      for (const func of functions) {
        if (func.nestingDepth && func.nestingDepth > (config.rules['clean-code']['deep-nesting'].threshold as number)) {
          violations.push({
            file,
            line: func.startLine ?? func.line ?? 1,
            ruleId: 'clean-code.deep-nesting',
            message: `Function "${func.name}" has deep nesting: ${func.nestingDepth} levels (maximum: ${
              config.rules['clean-code']['deep-nesting'].threshold
            })`,
            severity: config.rules['clean-code']['deep-nesting'].severity as Severity
          });
        }
      }
    } catch { }
    
    return violations;
  }
};