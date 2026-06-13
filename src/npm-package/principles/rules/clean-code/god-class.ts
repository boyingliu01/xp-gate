import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const godClassRule: Rule = {
  id: 'clean-code.god-class',
  name: 'God Class Rule',
  threshold: config.rules['clean-code']['god-class'].threshold ?? 15,
  severity: config.rules['clean-code']['god-class'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
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
        
        if (methodCount > (config.rules['clean-code']['god-class'].threshold as number)) {
          violations.push({
            file,
            line: cls.line,
            ruleId: 'clean-code.god-class',
            message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${
              config.rules['clean-code']['god-class'].threshold
            })`,
            severity: config.rules['clean-code']['god-class'].severity as Severity
          });
        }
      }
    } catch { }
    
    return violations;
  }
};