import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

const EXCLUDED_NUMBERS = config.rules['clean-code']['magic-numbers'].exclude || [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024];

export const magicNumbersRule: Rule = {
  id: 'clean-code.magic-numbers',
  name: 'Magic Numbers Rule',
  threshold: 10,
  severity: config.rules['clean-code']['magic-numbers'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const ast = adapter.parseAST();
      
      let magicNumbers: { value: number, line: number }[] = [];
      
      try {
        if (typeof adapter.extract !== 'undefined') {
          const literals = adapter.extract();
          if (literals && Array.isArray(literals)) {
            magicNumbers = literals;
          }
        }
      } catch (e) {
      }
      
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
          severity: config.rules['clean-code']['magic-numbers'].severity as any
        });
      });
      
    } catch (error) {
    }
    
    return violations;
  }
};