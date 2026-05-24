import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const ispRule: Rule = {
  id: 'solid.isp',
  name: 'Interface Segregation Principle Rule',
  threshold: config.rules['solid']['isp'].methodThreshold ?? 10,
  severity: config.rules['solid']['isp'].severity as 'error' | 'warning' | 'info',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const typedAdapter = adapter as { extractInterfaces?: () => Array<{name?: string; line?: number; methodCount?: number;}> | undefined };
      const interfaces = typedAdapter.extractInterfaces?.() || [];
      
      for (const iface of interfaces) {
        const methodCount = iface.methodCount || 0;
        
        if (methodCount > (config.rules['solid']['isp'].methodThreshold as number)) {
          violations.push({
            file,
            line: iface.line ?? 1,
            ruleId: 'solid.isp',
            message: `Interface "${iface.name}" has too many methods: ${methodCount} (maximum: ${
              config.rules['solid']['isp'].methodThreshold
            }). Consider splitting into focused interfaces.`,
            severity: config.rules['solid']['isp'].severity as "error" | "warning" | "info"
          });
        }
      }
    } catch { }
    
    return violations;
  }
};