import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';

/** The shape the adapter hands us for one class. */
interface RawClass {
  code?: string;
  line?: number;
  name?: string;
  methodCount?: number;
  imports?: Record<string, unknown>;
}

/** A class, normalized for the checks below. */
interface ClassFacts {
  name: string | undefined;
  line: number;
  methodCount: number;
  importCategories: number;
}

/** Read the (optional) fields of a raw class once, with sane defaults. */
function readClass(raw: unknown): ClassFacts {
  const cls = raw as RawClass;
  return {
    name: cls.name,
    line: cls.line ?? 1,
    methodCount: cls.methodCount || 0,
    importCategories: cls.imports ? Object.keys(cls.imports).length : 0,
  };
}

/** Too many methods in one class. */
function methodViolation(
  facts: ClassFacts, file: string, maxMethods: number, severity: 'error' | 'warning' | 'info',
): Violation | null {
  if (facts.methodCount <= maxMethods) return null;
  return {
    file,
    line: facts.line,
    ruleId: 'solid.srp',
    severity,
    message: `Class "${facts.name}" has too many methods: ${facts.methodCount} (maximum: ${maxMethods}). Consider splitting into focused classes.`,
  };
}

/** Imports reaching across too many domains. */
function importViolation(
  facts: ClassFacts, file: string, severity: 'error' | 'warning' | 'info',
): Violation | null {
  if (facts.importCategories <= 3) return null;
  return {
    file,
    line: facts.line,
    ruleId: 'solid.srp',
    severity,
    message: `Class "${facts.name}" imports from ${facts.importCategories} different domains. Each class should focus on one responsibility.`,
  };
}

export const srpRule: Rule = {
  id: 'solid.srp',
  name: 'Single Responsibility Principle Rule',
  threshold: 15,
  severity: 'warning',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['solid']['srp'];
    const maxMethods = settings.methodThreshold as number;
    const sev = (settings.severity as 'error' | 'warning' | 'info') ?? 'warning';

    const violations: Violation[] = [];
    for (const raw of adapter.extractClasses() || []) {
      const facts = readClass(raw);
      for (const found of [
        methodViolation(facts, file, maxMethods, sev),
        importViolation(facts, file, sev),
      ]) {
        if (found) violations.push(found);
      }
    }
    return violations;
  },
};
