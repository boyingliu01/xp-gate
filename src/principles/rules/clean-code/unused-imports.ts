import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const unusedImportsRule: Rule = {
  id: 'clean-code.unused-imports',
  name: 'Unused Imports Rule',
  threshold: 0,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['unused-imports'];
    
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
            severity: (settings.severity as Severity) ?? 'info'
          });
        }
      }
    } catch { }
    
    return violations;
  }
};