import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const deepNestingRule: Rule = {
  id: 'clean-code.deep-nesting',
  name: 'Deep Nesting Rule',
  threshold: 4,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['deep-nesting'];
    
    try {
      interface TypedAdapter {
        extractFunctions?: () => Array<{name?: string, nestingDepth?: number, startLine?: number, line?: number}> | undefined;
      }
      const typedAdapter = adapter as TypedAdapter;
      const functions = typedAdapter.extractFunctions?.() || [];
      
      for (const func of functions) {
        if (func.nestingDepth && func.nestingDepth > (settings.threshold ?? 0)) {
          violations.push({
            file,
            line: func.startLine ?? func.line ?? 1,
            ruleId: 'clean-code.deep-nesting',
            message: `Function "${func.name}" has deep nesting: ${func.nestingDepth} levels (maximum: ${
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