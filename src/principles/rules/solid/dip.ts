import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

const DEFAULT_EXCLUDED_CLASSES = [
  'Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'
];

/**
 * Read the excluded list from the ACTIVE config on each call.
 *
 * A module-load snapshot was #457: a project's `.principlesrc` override was
 * parsed but never consulted.
 */
function excludedClasses(): (string | number)[] {
  return getActiveConfig().rules['solid']['dip'].exclude ?? DEFAULT_EXCLUDED_CLASSES;
}

function shouldSkipInstantiation(className: string): boolean {
  if (excludedClasses().includes(className)) return true;
  if (className.endsWith('Factory') || className.endsWith('Builder')) return true;
  return false;
}

/**
 * Composition-root markers (#627): a class whose JOB is to construct and wire
 * concrete implementations. `new` there is dependency injection working, not being
 * bypassed -- measured on a real 178-file Java repo, all 29 `solid.dip` warnings
 * landed on 9 such wiring points.
 *
 * Matched against the class body text rather than a parsed AST because the rule
 * consumes whatever each language adapter emits as "class code", and those shapes
 * differ. These markers are conventions with low ambiguity, which is what makes a
 * text test acceptable here.
 */
const COMPOSITION_ROOT_MARKERS: RegExp[] = [
  // Spring / Quarkus / Micronaut configuration and bean producers.
  /@Configuration\b/, /@Bean\b/, /@Provides\b/, /@Produces\b/, /@Factory\b/,
  // DI module definitions (Dagger / Guice / Spring Java Config).
  /@Module\b/, /extends\s+AbstractModule\b/, /implements\s+Module\b/,
  // Framework lifecycle entry points: the framework built the object, so wiring
  // belongs in these methods.
  /\bvoid\s+init\s*\(/, /\bvoid\s+initialize\s*\(/, /\bvoid\s+afterPropertiesSet\s*\(/,
  /\bvoid\s+onCreate\s*\(/,
];

/** A static factory method -- the class is an assembler by construction. */
const STATIC_FACTORY_METHOD = /\bstatic\s+[\w<>\[\],.?\s]+\s+\w+\s*\(/;

/**
 * True when this class body is a composition root.
 *
 * A class whose name ends in Factory is already handled by
 * shouldSkipInstantiation for its PRODUCT names; this covers the assEMBLER itself,
 * e.g. `PlanCollectorFactory.assemble()` which news eight collaborators.
 */
function isCompositionRoot(code: string, className?: string): boolean {
  if (className && /(?:Factory|Assembler|Module|Config|Configuration|Provider)$/.test(className)) {
    return true;
  }
  if (COMPOSITION_ROOT_MARKERS.some((marker) => marker.test(code))) return true;
  return STATIC_FACTORY_METHOD.test(code);
}

/** `new Foo(` -> `Foo`. */
function classNameFromNewMatch(match: string): string {
  return match.replace(/new\s+/, '').replace(/\s*\(/, '');
}

/**
 * Violations for one class body: each `new X(` that is not exempt.
 *
 * #626: every violation used to carry the CLASS DECLARATION line, because the
 * adapter only reports where the class starts and the match itself carried no
 * position. A 200-line class with one instantiation on line 187 therefore pointed
 * the developer at line 1 -- the message named the right file and the wrong place,
 * which is the least useful combination: it looks actionable and is not.
 *
 * The offset of each match within the class body is now added to the class's
 * starting line, so the reported line is the `new` expression itself. Multi-line
 * matches count their newlines, since a match may span `new Foo(\n  arg,\n)`.
 *
 * `classBodyStartLine` is the line the adapter says the class begins on; when the
 * adapter cannot say (0), the violation keeps 0 rather than inventing line 1 --
 * a placeholder 1 would look like a real location.
 */
function instantiationViolations(
  code: string, classBodyStartLine: number, file: string, severity: Severity,
): Violation[] {
  const violations: Violation[] = [];
  const newPattern = /new\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = newPattern.exec(code)) !== null) {
    const className = classNameFromNewMatch(match[0]);
    if (shouldSkipInstantiation(className)) continue;
    // Offset -> line: count the newlines between the class start and this match.
    const linesIntoBody = (code.slice(0, match.index).match(/\n/g) || []).length;
    const line = classBodyStartLine > 0 ? classBodyStartLine + linesIntoBody : 0;
    violations.push({
      file,
      line,
      ruleId: 'solid.dip',
      severity,
      message: `Direct instantiation detected: new ${className}(). Prefer dependency injection for flexibility.`,
    });
  }
  return violations;
}

/** Rule severity from the active config, defaulting to warning. */
function configuredSeverity(): Severity {
  const settings = getActiveConfig().rules['solid']['dip'];
  return (settings.severity as Severity) ?? 'warning';
}

/**
 * Violations contributed by ONE extracted class.
 *
 * Split out of `dipRule.check` to keep that function inside the CCN ratchet: the
 * #627 composition-root test and the #626 line arithmetic each added a branch, and
 * the ratchet is there to force exactly this trade rather than a baseline refresh.
 */
function classViolations(
  clsAny: unknown, file: string, severity: Severity,
): Violation[] {
  const cls = clsAny as { code?: string; line?: number; name?: string };
  if (!cls.code) return [];
  // #627: a composition root's `new` is the inversion working, not bypassed.
  // Skipping the whole class body is right here: when the class IS the wiring
  // point, every instantiation in it is wiring.
  if (isCompositionRoot(cls.code, cls.name)) return [];
  return instantiationViolations(cls.code, cls.line || 0, file, severity);
}

export const dipRule: Rule = {
  id: 'solid.dip',
  name: 'Dependency Inversion Principle Rule',
  threshold: 0,
  severity: 'warning',
  check: (file: string, adapter: import('../../types').Adapter): Violation[] => {
    const severity = configuredSeverity();
    return (adapter.extractClasses() || []).flatMap((clsAny) =>
      classViolations(clsAny, file, severity),
    );
  }
};
