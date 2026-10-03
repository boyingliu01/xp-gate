import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';

export const ocpRule: Rule = {
  id: 'solid.ocp',
  name: 'Open/Closed Principle Rule',
  threshold: 0,
  severity: 'info',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['solid']['ocp'];
    const severity = (settings.severity as "error" | "warning" | "info") ?? 'info';
    
    try {
      const classes = adapter.extractClasses() || [];
      
      for (const raw of classes) {
        const cls = raw as { code?: string; line?: number; name?: string };
        if (!cls.code) continue;
        
        const extendsMatch = cls.code.match(/extends\s+(\w+)/);
        if (extendsMatch) {
          const baseClass = extendsMatch[1];
          
          if (cls.code.includes(`class ${baseClass}`)) {
            violations.push({
              file,
              line: cls.line ?? 1,
              ruleId: 'solid.ocp',
              message: `Possible modification of base class "${baseClass}" while extending. Extension should not require modifying the base.`,
              severity: severity
            });
          }
        }
      }
    } catch { }
    
    return violations;
  }
};