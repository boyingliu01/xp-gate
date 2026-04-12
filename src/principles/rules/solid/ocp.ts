import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const ocpRule: Rule = {
  id: 'solid.ocp',
  name: 'Open/Closed Principle Rule',
  threshold: 0,
  severity: config.rules['solid']['ocp'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses() || [];
      
      for (const cls of classes) {
        if (!cls.code) continue;
        
        const extendsMatch = cls.code.match(/extends\s+(\w+)/);
        if (extendsMatch) {
          const baseClass = extendsMatch[1];
          
          if (cls.code.includes(`class ${baseClass}`)) {
            violations.push({
              file,
              line: cls.line,
              ruleId: 'solid.ocp',
              message: `Possible modification of base class "${baseClass}" while extending. Extension should not require modifying the base.`,
              severity: config.rules['solid']['ocp'].severity as any
            });
          }
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};