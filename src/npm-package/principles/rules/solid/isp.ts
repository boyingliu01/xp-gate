import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';

export const ispRule: Rule = {
  id: 'solid.isp',
  name: 'Interface Segregation Principle Rule',
  threshold: 10,
  severity: 'info',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['solid']['isp'];
    
    try {
      const typedAdapter = adapter as { extractInterfaces?: () => Array<{name?: string; line?: number; methodCount?: number;}> | undefined };
      const interfaces = typedAdapter.extractInterfaces?.() || [];
      const maxMethods = settings.methodThreshold ?? 10;
      
      for (const iface of interfaces) {
        const methodCount = iface.methodCount || 0;
        
        if (methodCount > maxMethods) {
          violations.push({
            file,
            line: iface.line ?? 1,
            ruleId: 'solid.isp',
            message: `Interface "${iface.name}" has too many methods: ${methodCount} (maximum: ${
              maxMethods
            }). Consider splitting into focused interfaces.`,
            severity: (settings.severity as "error" | "warning" | "info") ?? 'info'
          });
        }
      }
    } catch { }
    
    return violations;
  }
};