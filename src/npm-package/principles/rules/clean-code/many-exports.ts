import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const manyExportsRule: Rule = {
  id: 'clean-code.many-exports',
  name: 'Many Exports Rule',
  threshold: 10,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['many-exports'];

    try {
      interface ExportObj {
        line: number;
      }
      
      interface TypedAdapter {
        extractExports?: () => ExportObj[] | undefined;
      }
      
      const typedAdapter = adapter as TypedAdapter;
      const exports = typedAdapter.extractExports ? typedAdapter.extractExports() : [];
      const threshold = settings.threshold ?? 10;
      
      if (exports && exports.length > threshold) {
        violations.push({
          file,
          line: exports[0]?.line || 1,
          ruleId: 'clean-code.many-exports',
          message: `Module has too many exports: ${exports.length} (maximum: ${threshold}). Consider splitting into focused sub-modules.`,
          severity: (settings.severity as Severity) ?? 'warning'
        });
      }
    } catch { }
    
    return violations;
  }
};
