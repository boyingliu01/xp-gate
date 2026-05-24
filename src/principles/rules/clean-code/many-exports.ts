import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const manyExportsRule: Rule = {
  id: 'clean-code.many-exports',
  name: 'Many Exports Rule',
  threshold: config.rules['clean-code']['many-exports'].threshold ?? 10,
  severity: config.rules['clean-code']['many-exports'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];

    try {
      interface ExportObj {
        line: number;
      }
      
      interface TypedAdapter {
        extractExports?: () => ExportObj[] | undefined;
      }
      
      const typedAdapter = adapter as TypedAdapter;
      const exports = typedAdapter.extractExports ? typedAdapter.extractExports() : [];
      const threshold = config.rules['clean-code']['many-exports'].threshold ?? 10;
      
      if (exports && exports.length > threshold) {
        violations.push({
          file,
          line: exports[0]?.line || 1,
          ruleId: 'clean-code.many-exports',
          message: `Module has too many exports: ${exports.length} (maximum: ${threshold}). Consider splitting into focused sub-modules.`,
          severity: config.rules['clean-code']['many-exports'].severity as Severity
        });
      }
    } catch { }
    
    return violations;
  }
};
