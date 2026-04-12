import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const largeFileRule: Rule = {
  id: 'clean-code.large-file',
  name: 'Large File Rule',
  threshold: config.rules['clean-code']['large-file'].threshold ?? 500,
  severity: config.rules['clean-code']['large-file'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const lineCount = adapter.countLines(file);
      
      if (lineCount > (config.rules['clean-code']['large-file'].threshold as number)) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.large-file',
          message: `File is too large: ${lineCount} lines (maximum: ${config.rules['clean-code']['large-file'].threshold})`,
          severity: config.rules['clean-code']['large-file'].severity as any
        });
      }
    } catch (error) {
    }
    
    return violations;
  }
};