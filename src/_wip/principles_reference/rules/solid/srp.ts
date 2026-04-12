import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks Single Responsibility Principle - should only have one reason to change
 */
export class SRPRule implements Rule {
  id = 'solid.srp';
  name = 'Single Responsibility Principle';
  description = 'A class should have one reason to change - not too many methods or diverse responsibilities';
  severity = 'warning';
  threshold = 15; // More than 15 methods, OR diverse import usage suggests SRP violation
  category = 'SOLID' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses(ast);
      
      for (const cls of classes) {
        // Check method count as a basic indicator
        if (cls.methods.length > this.threshold) {
          const violation: Violation = {
            ruleId: this.id,
            ruleName: this.name,
            file: fileName,
            line: cls.startLine,
            message: `Class "${cls.name}" has ${cls.methods.length} methods, suggesting it violates Single Responsibility Principle`,
            severity: this.severity,
            category: this.category,
            snippet: cls.sourceCode.split('\n').slice(0, 10).join('\n') + '...'
          };
          
          violations.push(violation);
        }
        
        // Additional check: look for multiple concern areas (not implemented fully here)
        // We could also evaluate diversity of imported modules or function purposes
      }
    } catch (error) {
      console.warn(`Error checking SRP in ${fileName}:`, error);
    }
    
    return violations;
  }
}