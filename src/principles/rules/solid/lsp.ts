import { Rule, Violation } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();

export const lspRule: Rule = {
  id: 'solid.lsp',
  name: 'Liskov Substitution Principle Rule',
  threshold: 0,
  severity: config.rules['solid']['lsp'].severity as "error" | "warning" | "info",
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const violations: Violation[] = [];
    
    try {
      const classes = adapter.extractClasses() || [];
      
      for (const raw of classes) {
        const cls = raw as { code?: string; line?: number; name?: string };
        if (!cls.code) continue;
        
        if (cls.code.includes('extends')) {
          const methodParams = cls.code.match(/\w+\s*\(([^)]+)\)/g) || [];
          
          for (const methodSignature of methodParams) {
            const paramsMatch = methodSignature.match(/\(([^)]+)\)/);
            if (paramsMatch) {
              const params = paramsMatch[1].split(',').map((p: string) => p.trim());
              
              for (const param of params) {
                if (param.includes(':')) {
                  const typeMatch = param.match(/:\s*(\w+)/);
                  if (typeMatch) {
                    const paramType = typeMatch[1];
                    const primitiveTypes = ['string', 'number', 'boolean', 'any', 'void', 'null', 'undefined', 'Object', 'Array'];
                    
                    if (!primitiveTypes.includes(paramType) && !(cls.name && paramType.startsWith(cls.name))) {
                      violations.push({
                        file,
                        line: cls.line ?? 0,
                        ruleId: 'solid.lsp',
                        message: `Possible LSP violation in "${cls.name}". Parameter type "${paramType}" may not be compatible with base class contract.`,
                        severity: config.rules['solid']['lsp'].severity as "error" | "warning" | "info"
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch { }
    
    return violations;
  }
};