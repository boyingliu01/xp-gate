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
  check: checkSrp,
};

/** The severity vocabulary this rule reports with. */
type SrpSeverity = 'error' | 'warning' | 'info';

/**
 * Every SRP violation in one file.
 *
 * The config is read PER INVOCATION; a module-load snapshot was #457, which made a
 * project's own threshold parse but never apply.
 */
function checkSrp(file: string, adapter: import('../../types').Adapter): Violation[] {
  const settings = getActiveConfig().rules.solid.srp;
  const maxMethods = settings.methodThreshold as number;
  const sev = (settings.severity as SrpSeverity) ?? 'warning';
  return (adapter.extractClasses() || [])
    .flatMap((raw) => violationsForClass(readClass(raw), file, maxMethods, sev));
}

/**
 * Both checks for one class.
 *
 * A class can break SRP on methods AND on imports; reporting only the first would make
 * the second invisible once the first is fixed.
 */
function violationsForClass(
  facts: ClassFacts,
  file: string,
  maxMethods: number,
  sev: SrpSeverity,
): Violation[] {
  return [methodViolation(facts, file, maxMethods, sev), importViolation(facts, file, sev)]
    .filter((found): found is Violation => found !== null);
}
