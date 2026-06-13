import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const largeFileRule: Rule = {
  id: 'clean-code.large-file',
  name: 'Large File Rule',
  threshold: config.rules['clean-code']['large-file'].threshold ?? 500,
  severity: config.rules['clean-code']['large-file'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      interface TypedAdapter {
        countLines?: (file: string) => number | undefined;
      }
      const typedAdapter = adapter as TypedAdapter;
      const lineCount = typedAdapter.countLines?.(file) ?? 0;
      
      if (lineCount > (config.rules['clean-code']['large-file'].threshold as number)) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.large-file',
          message: `File is too large: ${lineCount} lines (maximum: ${config.rules['clean-code']['large-file'].threshold})`,
          severity: config.rules['clean-code']['large-file'].severity as Severity
        });
      }
    } catch { }
    
    return violations;
  }
};