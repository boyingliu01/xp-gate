import { Rule, Violation, Severity } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

const EXCLUDED_NUMBERS = config.rules['clean-code']['magic-numbers'].exclude || [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024];

export const magicNumbersRule: Rule = {
  id: 'clean-code.magic-numbers',
  name: 'Magic Numbers Rule',
  threshold: 10,
  severity: config.rules['clean-code']['magic-numbers'].severity as Severity,
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      interface NumberObject {
        value: number;
        line: number;
      }
      
      interface TypedAdapter {
        parseAST?: () => unknown | undefined;
        extract?: () => NumberObject[] | undefined;
      }
      
      const typedAdapter = adapter as TypedAdapter;
      
      let magicNumbers: NumberObject[] = [];
      
      try {
        if (typeof typedAdapter.extract !== 'undefined') {
          const literals = typedAdapter.extract?.();
          if (literals && Array.isArray(literals)) {
            magicNumbers = literals;
          }
        }
      } catch { }
      
      const filteredNumbers = magicNumbers.filter(numObj => {
        const numValue = numObj.value;
        return !EXCLUDED_NUMBERS.includes(numValue);
      });
      
      filteredNumbers.forEach(numObj => {
        violations.push({
          file,
          line: numObj.line,
          ruleId: 'clean-code.magic-numbers',
          message: `Potential magic number detected: ${numObj.value}. Consider using a named constant instead.`,
          severity: config.rules['clean-code']['magic-numbers'].severity as Severity
        });
      });
      
    } catch { }
    
    return violations;
  }
};