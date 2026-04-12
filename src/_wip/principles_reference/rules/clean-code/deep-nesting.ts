import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks if functions have more than 4 levels of nested code
 */
export class DeepNestingRule implements Rule {
  id = 'clean-code.deep-nesting';
  name = 'Deep Nesting';
  description = 'Functions should not exceed 4 levels of nested code (if, for, while, etc.)';
  severity = 'warning';
  threshold = 4;
  category = 'Complexity' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions(ast);
      
      for (const func of functions) {
        // Check if this function has excessive nesting depth
        if (func.nestingDepth > this.threshold) {
          const violation: Violation = {
            ruleId: this.id,
            ruleName: this.name,
            file: fileName,
            line: func.startLine,
            message: `Function "${func.name}" has nesting depth of ${func.nestingDepth}, exceeding the ${this.threshold} level limit`,
            severity: this.severity,
            category: this.category,
            snippet: func.sourceCode.split('\n').slice(0, Math.min(10, func.sourceCode.split('\n').length)).join('\n')
          };
          
          violations.push(violation);
        }
      }
    } catch (error) {
      console.warn(`Error checking nesting depths in ${fileName}:`, error);
    }
    
    return violations;
  }
}