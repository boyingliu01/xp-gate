import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks if classes have more than 15 non-getter/setter methods
 */
export class GodClassRule implements Rule {
  id = 'clean-code.god-class';
  name = 'God Class';
  description = 'Classes should not have more than 15 non-getter/setter methods';
  severity = 'warning';
  threshold = 15;
  category = 'Design' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses(ast);
      
      for (const cls of classes) {
        // Filter out getter and setter methods
        const nonAccessorMethods = cls.methods.filter(method => 
          !this.isGetterOrSetter(method.name) && !this.isCommonUtilityMethod(method.name)
        );
        
        if (nonAccessorMethods.length > this.threshold) {
          const violation: Violation = {
            ruleId: this.id,
            ruleName: this.name,
            file: fileName,
            line: cls.startLine,
            message: `Class "${cls.name}" has ${nonAccessorMethods.length} non-accessor methods, exceeding the ${this.threshold} method limit`,
            severity: this.severity,
            category: this.category,
            snippet: cls.sourceCode.slice(0, 100) + '...'
          };
          
          violations.push(violation);
        }
      }
    } catch (error) {
      console.warn(`Error checking god classes in ${fileName}:`, error);
    }
    
    return violations;
  }

  private isGetterOrSetter(methodName: string): boolean {
    // Matches methods that are typically getters/setters
    return /^get[A-Z]/.test(methodName) || /^set[A-Z]/.test(methodName);
  }

  private isCommonUtilityMethod(methodName: string): boolean {
    // Common utility/boilerplate methods that shouldn't count toward the responsibility
    const utilityMethodPatterns = [
      /^toString$/,
      /^equals$/,
      /^hashCode$/,
      /^clone$/,
      /^toJSON$/,
      /^toXml$/,
      /^valueOf$/,
      /^compareTo$/,
      /^serialize$/,
      /^deserialize$/,
      /^build$/,
      /^validate$/,
      /^initialize$/,
      /^dispose$/,
      /^is[A-Z]/
    ];
    
    return utilityMethodPatterns.some(pattern => pattern.test(methodName));
  }
}