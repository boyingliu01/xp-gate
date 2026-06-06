import { Rule, Violation, Adapter } from '../../types';
import { getDefaultConfig } from '../../config';

const config = getDefaultConfig();
const severity = config.rules['solid']['lsp'].severity as 'error' | 'warning' | 'info';
const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'void', 'null', 'undefined', 'Object', 'Array',
]);

interface ClassInfo {
  code?: string;
  line?: number;
  name?: string;
}

function extractParamType(param: string): string | null {
  if (!param.includes(':')) return null;
  const typeMatch = param.match(/:\s*(\w+)/);
  return typeMatch ? typeMatch[1] : null;
}

function isCompatibleParamType(paramType: string, className: string | undefined): boolean {
  if (PRIMITIVE_TYPES.has(paramType)) return true;
  if (className && paramType.startsWith(className)) return true;
  return false;
}

function collectMethodParamTypes(methodSignature: string): string[] {
  const paramsMatch = methodSignature.match(/\(([^)]+)\)/);
  if (!paramsMatch) return [];
  const types: string[] = [];
  for (const param of paramsMatch[1].split(',').map((p) => p.trim())) {
    const paramType = extractParamType(param);
    if (paramType) types.push(paramType);
  }
  return types;
}

function buildViolation(file: string, cls: ClassInfo, paramType: string): Violation {
  return {
    file,
    line: cls.line ?? 0,
    ruleId: 'solid.lsp',
    message: `Possible LSP violation in "${cls.name}". Parameter type "${paramType}" may not be compatible with base class contract.`,
    severity,
  };
}

function checkClass(file: string, cls: ClassInfo): Violation[] {
  if (!cls.code || !cls.code.includes('extends')) return [];

  const violations: Violation[] = [];
  const methodSignatures = cls.code.match(/\w+\s*\(([^)]+)\)/g) || [];

  for (const methodSignature of methodSignatures) {
    for (const paramType of collectMethodParamTypes(methodSignature)) {
      if (!isCompatibleParamType(paramType, cls.name)) {
        violations.push(buildViolation(file, cls, paramType));
      }
    }
  }

  return violations;
}

export const lspRule: Rule = {
  id: 'solid.lsp',
  name: 'Liskov Substitution Principle Rule',
  threshold: 0,
  severity,
  check: (file: string, adapter: Adapter): Violation[] => {
    try {
      const classes = (adapter.extractClasses() || []) as ClassInfo[];
      return classes.flatMap((cls) => checkClass(file, cls));
    } catch {
      return [];
    }
  },
};
