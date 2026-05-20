import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const manyExportsRule: Rule = {
  id: 'clean-code.many-exports',
  name: 'Many Exports Rule',
  threshold: config.rules['clean-code']['many-exports'].threshold ?? 10,
  severity: config.rules['clean-code']['many-exports'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    const threshold = config.rules['clean-code']['many-exports'].threshold ?? 10;

    try {
      const exports = adapter.extractExports ? adapter.extractExports() : [];
      const threshold = config.rules['clean-code']['many-exports'].threshold ?? 10;
      
      if (exports.length > threshold) {
        violations.push({
          file,
          line: exports[0]?.line || 1,
          ruleId: 'clean-code.many-exports',
          message: `Module has too many exports: ${exports.length} (maximum: ${threshold}). Consider splitting into focused sub-modules.`,
          severity: config.rules['clean-code']['many-exports'].severity as any
        });
      }
    } catch (error) {
    }
    
    return violations;
  }
};
