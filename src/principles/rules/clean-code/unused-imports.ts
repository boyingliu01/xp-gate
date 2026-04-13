import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const unusedImportsRule: Rule = {
  id: 'clean-code.unused-imports',
  name: 'Unused Imports Rule',
  threshold: 1,
  severity: config.rules['clean-code']['unused-imports'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const imports = adapter.imports || [];
      
      for (const imp of imports) {
        if (!imp.used && imp.type !== 'type') {
          violations.push({
            file,
            line: imp.line,
            ruleId: 'clean-code.unused-imports',
            message: `Unused import "${imp.name}" - consider removing`,
            severity: config.rules['clean-code']['unused-imports'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};