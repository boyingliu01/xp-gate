import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

const DEFAULT_EXCLUDED_NUMBERS = [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024];

export const magicNumbersRule: Rule = {
  id: 'clean-code.magic-numbers',
  name: 'Magic Numbers Rule',
  // Not config-derived: this rule reports every non-excluded literal, so the
  // static field is an informational placeholder rather than an enforced bound.
  threshold: 10,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['magic-numbers'];
    
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
      
      const excludedNumbers = settings.exclude ?? DEFAULT_EXCLUDED_NUMBERS;
      const filteredNumbers = magicNumbers.filter(numObj => {
        const numValue = numObj.value;
        return !excludedNumbers.includes(numValue);
      });
      
      filteredNumbers.forEach(numObj => {
        violations.push({
          file,
          line: numObj.line,
          ruleId: 'clean-code.magic-numbers',
          message: `Potential magic number detected: ${numObj.value}. Consider using a named constant instead.`,
          severity: (settings.severity as Severity) ?? 'info'
        });
      });
      
    } catch { }
    
    return violations;
  }
};