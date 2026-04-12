import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks if functions/methods have more than 7 parameters
 */
export class TooManyParametersRule implements Rule {
  id = 'clean-code.too-many-params';
  name = 'Too Many Parameters';
  description = 'Functions should not have more than 7 parameters';
  severity = 'info';
  threshold = 7;
  category = 'Design' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      const functions = adapter.extractFunctions(ast);
      
      for (const func of functions) {
        if (func.parameters.length > this.threshold) {
          const violation: Violation = {
            ruleId: this.id,
            ruleName: this.name,
            file: fileName,
            line: func.startLine,
            message: `Function "${func.name}" has ${func.parameters.length} parameters, exceeding the ${this.threshold} parameter limit`,
            severity: this.severity,
            category: this.category,
            snippet: adapter.getFunctionSignature(func)
          };
          
          violations.push(violation);
        }
      }
    } catch (error) {
      console.warn(`Error checking function parameters in ${fileName}:`, error);
    }
    
    return violations;
  }
}