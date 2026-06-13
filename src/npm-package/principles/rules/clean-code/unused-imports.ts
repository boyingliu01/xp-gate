import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const unusedImportsRule: Rule = {
  id: 'clean-code.unused-imports',
  name: 'Unused Imports Rule',
  threshold: 1,
  severity: config.rules['clean-code']['unused-imports'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const typedAdapter = adapter as { imports?: Array<{name?: string; line?: number; used?: boolean; type?: string;}> | undefined };
      const imports = typedAdapter.imports || [];
      
      for (const imp of imports) {
        if (!imp.used && imp.type !== 'type') {
          violations.push({
            file,
            line: imp.line ?? 1,
            ruleId: 'clean-code.unused-imports',
            message: `Unused import "${imp.name}" - consider removing`,
            severity: config.rules['clean-code']['unused-imports'].severity as Severity
          });
        }
      }
    } catch { }
    
    return violations;
  }
};