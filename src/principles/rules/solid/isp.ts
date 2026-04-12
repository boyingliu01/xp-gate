import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const ispRule: Rule = {
  id: 'solid.isp',
  name: 'Interface Segregation Principle Rule',
  threshold: config.rules['solid']['isp'].methodThreshold ?? 10,
  severity: config.rules['solid']['isp'].severity as any,
  check: (file: string, adapter: any): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const interfaces = adapter.extractInterfaces?.() || [];
      
      for (const iface of interfaces) {
        const methodCount = iface.methodCount || 0;
        
        if (methodCount > (config.rules['solid']['isp'].methodThreshold as number)) {
          violations.push({
            file,
            line: iface.line,
            ruleId: 'solid.isp',
            message: `Interface "${iface.name}" has too many methods: ${methodCount} (maximum: ${
              config.rules['solid']['isp'].methodThreshold
            }). Consider splitting into focused interfaces.`,
            severity: config.rules['solid']['isp'].severity as any
          });
        }
      }
    } catch (error) {
    }
    
    return violations;
  }
};