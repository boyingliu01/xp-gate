import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

/** The config shape this rule reads. */
interface GodClassSettings {
  threshold?: number;
  severity?: string;
}

/**
 * Every god-class violation in one file.
 *
 * The config is read PER INVOCATION; a module-load snapshot was #457.
 */
function checkGodClass(file: string, adapter: unknown): Violation[] {
  const settings = getActiveConfig().rules['clean-code']['god-class'] as GodClassSettings;
  return extractClasses(adapter)
    .flatMap((cls) => violationFor(cls, file, settings, settings.threshold ?? 0));
}

export const godClassRule: Rule = {
  id: 'clean-code.god-class',
  name: 'God Class Rule',
  threshold: 15,
  severity: 'warning',
  check: checkGodClass,
};

/**
 * A class as the adapter reports it.
 *
 * `methodCount` is optional because not every adapter parses classes structurally; the
 * regex fallback covers the rest.
 */
interface ClassObject {
  code?: string;
  line: number;
  name: string;
  /** Method count when the adapter parsed the class structurally. */
  methodCount?: number;
}

/** The part of an adapter this rule consumes. */
interface TypedAdapter {
  extractClasses?: () => ClassObject[] | undefined;
}

/** The classes the adapter reports, or none when it cannot report any. */
function extractClasses(adapter: unknown): ClassObject[] {
  return (adapter as TypedAdapter).extractClasses?.() || [];
}

/**
 * The violation for one class, or no violations.
 *
 * Prefer the adapter's STRUCTURAL count. The regex fallback cannot see a method whose
 * signature spans lines or carries a return type, so on `TypeScriptAdapter` (66 methods)
 * it counted 0 while `solid.srp` read the adapter's own figure -- the same class, two
 * different answers, and the wrong one was silent. A count the adapter already computed
 * must never be re-derived by guessing at source text.
 */
function violationFor(
  cls: ClassObject,
  file: string,
  settings: GodClassSettings,
  threshold: number,
): Violation[] {
  const methodCount = cls.methodCount ?? countMethodsByRegex(cls.code);
  if (methodCount <= threshold) return [];
  return [{
    file,
    line: cls.line,
    ruleId: 'clean-code.god-class',
    message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${threshold})`,
    severity: (settings.severity as Severity) ?? 'warning',
  }];
}

/**
 * Source-text method matcher.
 *
 * Kept at module scope on purpose: ccn-report locates a function body by counting
 * brackets on its lines, so a regex literal inside the body makes the extent
 * ambiguous and the row comes back "CCN could not be span-verified".
 */
const METHOD_PATTERN = /(?:get|set)\s+\w+\s*[(]|\w+\s*[(][^)]*[)]\s*[{]/g;

/** A matched accessor keyword pair rather than a real method. */
const ACCESSOR_PATTERN = /^(?:get|set)\s/;

/**
 * Count methods by matching source text. Only used when the adapter does not
 * report `methodCount` (Java, C++ and other regex-backed adapters), so the
 * getter/setter exclusion stays meaningful.
 */
function countMethodsByRegex(code: string | undefined): number {
  const methodMatches = code?.match(METHOD_PATTERN) ?? [];
  return methodMatches.filter((m: string) => !ACCESSOR_PATTERN.test(m)).length;
}