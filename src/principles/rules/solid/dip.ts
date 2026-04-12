import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

const EXCLUDED_CLASSES = config.rules['solid']['dip'].exclude || [
  'Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'
];

export const dipRule: Rule = {
  id: 'solid.dip',
  name: 'Dependency Inversion Principle Rule',
  threshold: 0,
  severity: config.rules['solid']['dip'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses() || [];
      
      for (const cls of classes) {
        if (!cls.code) continue;
        
        const newMatches = cls.code.match(/new\s+(\w+)\s*\(/g) || [];
        
        for (const match of newMatches) {
          const className = match.replace(/new\s+/, '').replace(/\s*\(/, '');
          
          if (EXCLUDED_CLASSES.includes(className)) {
            continue;
          }
          
          if (className.endsWith('Factory') || className.endsWith('Builder')) {
            continue;
          }
          
          violations.push({
            file,
            line: cls.line,
            ruleId: 'solid.dip',
            message: `Direct instantiation detected: new ${className}(). Prefer dependency injection for flexibility.`,
            severity: config.rules['solid']['dip'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};