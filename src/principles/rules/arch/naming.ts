import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';
import { extractPackageSegments, classNamesOf, readSeverity, isUnrecognisedJavaLayout } from './shared';

/**
 * ARCH-07 (#694) — Java naming rules R10 / R11 / R12.
 *
 * These are the only three of the 33 ArchUnit rules that need nothing but the
 * file path and the class names, so they run in pre-commit instead of waiting
 * for Maven. That is the whole point: the expensive rules live behind
 * `mvn test` and therefore rarely run locally.
 *
 * The package is read from the FILE PATH, not from the `package` declaration or
 * an import. A path is what the hook actually has, it survives files whose
 * package statement disagrees with their location (a real and common mistake),
 * and it works before the file compiles.
 */

/** Rule ids. Namespaced `arch.*` so they group apart from clean-code and solid. */
const CONTROLLER_RULE_ID = 'arch.controller';
const SERVICE_RULE_ID = 'arch.service';
const REPOSITORY_RULE_ID = 'arch.repository';

/** The controller package, relative to the source root. */
const CONTROLLER_PACKAGE = ['interfaces', 'rest'];
/** The service package, relative to the source root. */
const SERVICE_PACKAGE = ['application', 'service'];
/** The two persistence packages that share one naming rule. */
const REPOSITORY_PACKAGES = [
  ['infrastructure', 'repository'],
  ['infrastructure', 'gateway'],
];

/**
 * Whether `segments` contains `wanted` as a contiguous run.
 *
 * A contiguous run, not a set: `interfaces/rest` must match a package that
 * reads exactly that way. Treating it as a set would also match
 * `rest/interfaces`, which is a different package.
 */
function containsRun(segments: string[], wanted: string[]): boolean {
  for (let start = 0; start + wanted.length <= segments.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (segments[start + offset] !== wanted[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Whether a class name ends with any of `suffixes`. Case-sensitive by design. */
function endsWithAny(name: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

/**
 * Build one naming rule.
 *
 * All three share the same shape: "inside package P, every class name must end
 * with one of S". Writing them once, parameterised, keeps the package-matching
 * and severity-reading logic from drifting between the three.
 */
/**
 * The `info` finding a naming rule reports for a file it could not judge.
 *
 * Returns null when the layout IS recognised, so the rule proceeds normally.
 * Kept as a separate function so the shared `check()` body stays readable: the
 * skip path is one concern, the naming test is another.
 *
 * Deliberately consulted BEFORE the package-scope test. `inScope` asks "is this
 * package in my remit?", not "should this file be analysed" -- the analyzer has
 * already applied the user's path filters before calling `check()`. Do not add
 * path filtering inside a rule, or this diagnostic would bypass those filters.
 */
function unrecognisedLayoutFinding(file: string, ruleId: string): Violation | null {
  if (!isUnrecognisedJavaLayout(file)) return null;
  return {
    file,
    line: 1,
    ruleId,
    message:
      `Skipped: ${file} has no recognisable Java source root, so this rule ` +
      'could not judge it. Use a standard src/<scope>/java layout, or read ' +
      'this empty result as "not examined" rather than "no violations".',
    severity: 'info',
  };
}

function buildNamingRule(options: {
  id: string;
  name: string;
  /** Package runs; a class is in scope when ANY of them matches. */
  packages: string[][];
  suffixes: string[];
  /** Human-readable package description used in the message. */
  packageLabel: string;
  /** Shown after "must end with", already joined for display. */
  suffixLabel: string;
  configKey: 'controller' | 'service' | 'repository';
}): Rule {
  return {
    id: options.id,
    name: options.name,
    threshold: 0,
    severity: 'error',
    check: (file: string, adapter: unknown): Violation[] => {
      // Read the ACTIVE config per invocation; a module-load snapshot was #457.
      const severity: Severity = readSeverity(
        getActiveConfig().rules.arch,
        options.configKey,
        'error',
      );

      // A Java/Kotlin file whose source root we cannot read yields no segments,
      // so the package test below never matches and this rule silently reports
      // nothing -- which reads as "clean". Announce the skip instead.
      const skipped = unrecognisedLayoutFinding(file, options.id);
      if (skipped) return [skipped];

      const segments = extractPackageSegments(file);
      const inScope = options.packages.some((wanted) => containsRun(segments, wanted));
      // Out-of-scope files are the common case; bail before touching the adapter.
      if (!inScope) return [];

      return classNamesOf(adapter)
        .filter((cls) => !endsWithAny(cls.name, options.suffixes))
        .map((cls) => ({
          file,
          line: cls.line ?? 1,
          ruleId: options.id,
          message:
            `Class "${cls.name}" in ${options.packageLabel} must end with ` +
            `${options.suffixLabel} (found "${cls.name}")`,
          severity,
        }));
    },
  };
}

/** R10 — classes in `interfaces/rest` must be `*Controller`. */
export const controllerNamingRule: Rule = buildNamingRule({
  id: CONTROLLER_RULE_ID,
  name: 'Controller Naming Rule (R10)',
  packages: [CONTROLLER_PACKAGE],
  suffixes: ['Controller'],
  packageLabel: 'interfaces/rest',
  suffixLabel: '"Controller"',
  configKey: 'controller',
});

/** R11 — classes in `application/service` must be `*Service` or `*ServiceImpl`. */
export const serviceNamingRule: Rule = buildNamingRule({
  id: SERVICE_RULE_ID,
  name: 'Service Naming Rule (R11)',
  packages: [SERVICE_PACKAGE],
  // `ServiceImpl` is listed explicitly rather than implied by `Service`:
  // it documents that both forms are sanctioned, and a future reader cannot
  // mistake `Service` alone for the whole intent.
  suffixes: ['Service', 'ServiceImpl'],
  packageLabel: 'application/service',
  suffixLabel: '"Service" or "ServiceImpl"',
  configKey: 'service',
});

/** R12 — classes in `infrastructure/repository` or `.../gateway` must be persistence-named. */
export const repositoryNamingRule: Rule = buildNamingRule({
  id: REPOSITORY_RULE_ID,
  name: 'Repository Naming Rule (R12)',
  packages: REPOSITORY_PACKAGES,
  // `DAO` is uppercase because that is the documented form. `Dao` is NOT
  // accepted, and the case sensitivity is deliberate: see AC-694-05, where
  // `UserDao` must be reported. Lower-casing here would make the rule accept
  // the very name the standard rejects.
  suffixes: ['Mapper', 'DAO', 'Repository'],
  packageLabel: 'infrastructure/repository or infrastructure/gateway',
  suffixLabel: '"Mapper", "DAO" or "Repository"',
  configKey: 'repository',
});

export const archNamingRules: Rule[] = [
  controllerNamingRule,
  serviceNamingRule,
  repositoryNamingRule,
];
