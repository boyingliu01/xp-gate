import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks if functions in code exceed 50 lines of code
 */
export class LongFunctionRule implements Rule {
  id = 'clean-code.long-function';
  name = 'Long Function';
  description = 'Functions should not exceed 50 lines of code';
  severity = 'warning';
  threshold = 50;
  category = 'Complexity' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions(ast);
      
      for (const func of functions) {
        // Skip if function is shorter than threshold
        if (func.linesOfCode <= this.threshold) {
          continue;
        }

        const violation: Violation = {
          ruleId: this.id,
          ruleName: this.name,
          file: fileName,
          line: func.startLine,
          message: `Function "${func.name}" is ${func.linesOfCode} lines long, exceeding the ${this.threshold} line limit`,
          severity: this.severity,
          category: this.category,
          snippet: func.sourceCode.slice(0, 100) + (func.sourceCode.length > 100 ? '...' : '')
        };
        
        violations.push(violation);
      }
    } catch (error) {
      console.warn(`Error checking long functions in ${fileName}:`, error);
    }
    
    return violations;
  }
}