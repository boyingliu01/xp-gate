import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const godClassRule: Rule = {
  id: 'clean-code.god-class',
  name: 'God Class Rule',
  threshold: 15,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['god-class'];
    
    interface ClassObject {
      code?: string;
      line: number;
      name: string;
      /** Method count when the adapter parsed the class structurally. */
      methodCount?: number;
    }

    interface TypedAdapter {
      extractClasses?: () => ClassObject[] | undefined;
    }

    const typedAdapter = adapter as TypedAdapter;
    const classes = typedAdapter.extractClasses?.() || [];

    for (const cls of classes) {
      // Prefer the adapter's structural count. The regex fallback below cannot
      // see methods whose signature spans lines or carries a return type, so on
      // `TypeScriptAdapter` (66 methods) it counted 0 while `solid.srp` read the
      // adapter's own figure and reported it -- the same class, two different
      // answers, and the wrong one was silent. A count the adapter already
      // computed must not be recomputed by guessing at source text.
      const methodCount = cls.methodCount ?? countMethodsByRegex(cls.code);

      if (methodCount > (settings.threshold ?? 0)) {
        violations.push({
          file,
          line: cls.line,
          ruleId: 'clean-code.god-class',
          message: `Class "${cls.name}" has too many methods: ${methodCount} (maximum: ${
            settings.threshold
          })`,
          severity: (settings.severity as Severity) ?? 'warning'
        });
      }
    }

    return violations;
  }
};

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