import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const srpRule: Rule = {
  id: 'solid.srp',
  name: 'Single Responsibility Principle Rule',
  threshold: config.rules['solid']['srp'].methodThreshold ?? 15,
  severity: config.rules['solid']['srp'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses() || [];
      
      for (const cls of classes) {
        const methodCount = cls.methodCount || 0;
        const importCategories = cls.imports ? Object.keys(cls.imports).length : 0;
        
        if (methodCount > (config.rules['solid']['srp'].methodThreshold as number)) {
          violations.push({
            file,
            line: cls.line,
            ruleId: 'solid.srp',
            message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${
              config.rules['solid']['srp'].methodThreshold
            }). Consider splitting into focused classes.`,
            severity: config.rules['solid']['srp'].severity as any
          });
        }
        
        if (importCategories > 3) {
          violations.push({
            file,
            line: cls.line,
            ruleId: 'solid.srp',
            message: `Class "${cls.name}" imports from ${importCategories} different domains. Each class should focus on one responsibility.`,
            severity: config.rules['solid']['srp'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};