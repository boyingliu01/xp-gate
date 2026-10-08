import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const godClassRule: Rule = {
  id: 'clean-code.god-class',
  name: 'God Class Rule',
  threshold: 15,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['god-class'];
    
    try {
      interface ClassObject {
        code?: string;
        line: number;
        name: string;
      }
      
      interface TypedAdapter {
        extractClasses?: () => ClassObject[] | undefined;
      }
      
      const typedAdapter = adapter as TypedAdapter;
      const classes = typedAdapter.extractClasses?.() || [];
      
      for (const cls of classes) {
        const methodMatches = cls.code?.match(/(get|set)\s+\w+\s*\(|\w+\s*\([^)]*\)\s*{/g) || [];
        
        const methodCount = methodMatches.filter((m: string) => {
          if (m.startsWith('get ') || m.startsWith('set ')) {
            return false;
          }
          return true;
        }).length;
        
        if (methodCount > (settings.threshold ?? 0)) {
          violations.push({
            file,
            line: cls.line,
            ruleId: 'clean-code.god-class',
            message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${
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