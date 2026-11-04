import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';
import {
  extractPackageSegments,
  isTestSource,
  classNamesOf,
  importsOf,
  readSeverity,
  simpleNameOf,
  packageSegmentsOf,
} from './shared';

/**
 * ARCH-12 (#699) — Java dependency-direction rules R08 / R15 / W01.
 *
 * Three rules, all answerable from the file path plus the import list, so they
 * run in pre-commit rather than behind `mvn test`.
 *
 * ## What each rule judges, and why they judge it differently
 *
 * The three deliberately do NOT use the same signal, and that is not an
 * inconsistency to be tidied away:
 *
 * - **R08** judges the imported CLASS NAME. It forbids "a DTO depends on a
 *   service", and service/repository classes are named differently in every
 *   project's package scheme, so no fixed package path can express it.
 * - **R15** judges PACKAGE SEGMENTS on both sides. "The domain-event layer must
 *   not depend on the infrastructure layer" is a statement about the layer
 *   structure this standard prescribes, and a layer is defined by its package.
 * - **W01** judges the source FILE NAME plus the imported CLASS NAME.
 *
 * So R08 rejecting package-path matching is not contradicted by R15 using it:
 * R08 rejects *guessing a dependency's role from its package*, not package
 * matching in general.
 */

const DTO_RULE_ID = 'arch.dto-layering';
const DOMAIN_EVENT_RULE_ID = 'arch.domain-event';
const UTIL_SERVICE_RULE_ID = 'arch.util-service';

/** Class-name suffixes that make an import a "service" for R08/W01 purposes. */
const SERVICE_SUFFIXES = ['Service', 'ServiceImpl'];
/** Class-name suffixes that make an import a "repository" for R08 purposes. */
const REPOSITORY_SUFFIXES = ['Repository', 'Mapper', 'DAO'];

/**
 * Suffixes that DISQUALIFY a match, checked BEFORE the suffix hit.
 *
 * Without this list `OrderServiceConstants` and `PaymentServiceFacade` match
 * `*Service` and get reported as service dependencies, which they are not. The
 * exclusions are what make the suffix heuristic usable on a real codebase --
 * see AC-699-09. Do not delete this as "redundant with SERVICE_SUFFIXES".
 */
const EXCLUDED_SUFFIXES = [
  'Constants',
  'Facade',
  'Config',
  'Exception',
  'Test',
  'Factory',
  'Builder',
  'DTO',
  'VO',
  'Util',
];

/**
 * Framework package prefixes whose types are provided by a library, not by the
 * project's application layer.
 *
 * `DiscoveryService` matches `*Service` but comes from Spring, so warning that
 * an `OrderHelper` depends on it is pure noise (AC-699-12). A closed list, not
 * a user-maintained allowlist: it can grow with real reports, but it never asks
 * a project to maintain it before the rule is useful.
 */
const FRAMEWORK_PREFIXES = [
  'java.',
  'javax.',
  'jakarta.',
  'org.springframework.',
  'com.fasterxml.',
  'com.google.',
  'org.apache.',
];

/** Class-name suffixes that make a source file a "utility" for W01. */
const UTIL_SOURCE_SUFFIXES = ['Util', 'Utils', 'Helper'];

/** The DTO / VO suffixes R08 constrains. */
const DTO_SUFFIXES = ['DTO', 'Dto', 'VO'];

/** The file's base name without the `.java` extension (`.../UserDTO.java` -> `UserDTO`). */
function baseNameOf(file: string): string {
  const name = file.split('\\').join('/').split('/').pop() ?? '';
  return name.replace(/\.java$/i, '');
}

/** Whether `name` ends with any of `suffixes`. Case-sensitive by design. */
function endsWithAny(name: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

/**
 * Whether an imported type counts as a service/repository at all.
 *
 * The exclusion check runs first so that a disqualified name is never treated
 * as a dependency violation, however many suffixes it happens to match.
 */
function dependencyRole(fullyQualified: string): 'service' | 'repository' | null {
  const simpleName = simpleNameOf(fullyQualified);
  if (endsWithAny(simpleName, EXCLUDED_SUFFIXES)) return null;
  if (endsWithAny(simpleName, SERVICE_SUFFIXES)) return 'service';
  if (endsWithAny(simpleName, REPOSITORY_SUFFIXES)) return 'repository';
  return null;
}

/** Whether an imported type comes from a framework/library package. */
function isFrameworkType(fullyQualified: string): boolean {
  return FRAMEWORK_PREFIXES.some((prefix) => fullyQualified.startsWith(prefix));
}

/**
 * Build the violation list for one file, skipping test sources.
 *
 * `src/test/java` is excluded wholesale: a test may be named anything, and the
 * dependency rules constrain production layering only.
 */
function checkFile(
  file: string,
  adapter: unknown,
  ruleId: string,
  severity: Severity,
  judge: (facts: {
    classes: Array<{ name: string; line?: number }>;
    imports: Array<{ name: string; line?: number }>;
    packageSegments: string[];
  }) => Array<{ line: number; message: string }>,
): Violation[] {
  if (isTestSource(file)) return [];
  const hits = judge({
    classes: classNamesOf(adapter),
    imports: importsOf(adapter),
    packageSegments: extractPackageSegments(file),
  });
  return hits.map((hit) => ({
    file,
    line: hit.line,
    ruleId,
    message: hit.message,
    severity,
  }));
}

/**
 * R08 — a DTO/VO must not import a service or a repository.
 *
 * Wildcard imports (`import com.acme.service.*;`) never reach here: the Java
 * adapter's import regex does not capture `*`, so the import list simply does
 * not contain them. That is the behaviour AC-699-14 pins down, and it is the
 * safer default -- a wildcard gives no class name to judge, and guessing one
 * from the package is exactly the false-positive source this rule avoids.
 */
export const dtoLayeringRule: Rule = {
  id: DTO_RULE_ID,
  name: 'DTO Dependency Layering Rule (R08)',
  threshold: 0,
  severity: 'error',
  check: (file: string, adapter: unknown): Violation[] => {
    const severity = readSeverity(getActiveConfig().rules.arch, 'dto-layering', 'error');
    return checkFile(file, adapter, DTO_RULE_ID, severity, ({ imports }) => {
      // Judged on the FILE name, not on extractClasses(): the question is
      // "is this file a DTO", and the file name is what carries a DTO's
      // identity. Requiring a parsed class would make the rule depend on the
      // adapter succeeding, and would go blind on a file the parser trips on.
      const sourceName = baseNameOf(file);
      if (!endsWithAny(sourceName, DTO_SUFFIXES)) return [];
      const hits: Array<{ line: number; message: string }> = [];
      for (const imp of imports) {
        const role = dependencyRole(imp.name);
        if (role === null) continue;
        const target = simpleNameOf(imp.name);
        hits.push({
          line: imp.line ?? 1,
          message:
            `DTO "${sourceName}" must not depend on ${role} "${target}" ` +
            `(imported from ${imp.name})`,
        });
      }
      return hits;
    });
  },
};

/**
 * R15 — a class in `domain/event` must not import from `infrastructure`.
 *
 * Judged on package segments, so a wildcard import IS caught here: the import
 * `com.acme.infrastructure.*` carries the layer name even without a class name.
 */
export const domainEventRule: Rule = {
  id: DOMAIN_EVENT_RULE_ID,
  name: 'Domain Event Dependency Rule (R15)',
  threshold: 0,
  severity: 'error',
  check: (file: string, adapter: unknown): Violation[] => {
    const severity = readSeverity(getActiveConfig().rules.arch, 'domain-event', 'error');
    return checkFile(file, adapter, DOMAIN_EVENT_RULE_ID, severity, ({ imports, packageSegments }) => {
      const inDomainEvent =
        packageSegments.includes('domain') && packageSegments.includes('event');
      if (!inDomainEvent) return [];
      const hits: Array<{ line: number; message: string }> = [];
      for (const imp of imports) {
        if (!packageSegmentsOf(imp.name).includes('infrastructure')) continue;
        hits.push({
          line: imp.line ?? 1,
          message:
            `Domain event must not depend on the infrastructure layer ` +
            `(imported from ${imp.name})`,
        });
      }
      return hits;
    });
  },
};

/**
 * W01 — a `*Util` / `*Utils` / `*Helper` should not depend on an application
 * service. WARNING only: it must never block a commit (AC-699-08), but it must
 * still be REPORTED (AC-699-11) -- "not blocking" is not "silent".
 */
export const utilServiceRule: Rule = {
  id: UTIL_SERVICE_RULE_ID,
  name: 'Utility Service Dependency Rule (W01)',
  threshold: 0,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const severity = readSeverity(getActiveConfig().rules.arch, 'util-service', 'warning');
    const sourceName = file.replace(/\\/g, '/').split('/').pop() ?? '';
    const baseName = sourceName.replace(/\.java$/i, '');
    if (!endsWithAny(baseName, UTIL_SOURCE_SUFFIXES)) return [];
    return checkFile(file, adapter, UTIL_SERVICE_RULE_ID, severity, ({ imports }) => {
      const hits: Array<{ line: number; message: string }> = [];
      for (const imp of imports) {
        // Framework services are not this project's application layer; skipping
        // them is what keeps AC-699-12 quiet.
        if (isFrameworkType(imp.name)) continue;
        if (dependencyRole(imp.name) !== 'service') continue;
        hits.push({
          line: imp.line ?? 1,
          message:
            `Utility "${baseName}" should not depend on application service ` +
            `"${simpleNameOf(imp.name)}" (imported from ${imp.name})`,
        });
      }
      return hits;
    });
  },
};

export const archDependencyRules: Rule[] = [
  dtoLayeringRule,
  domainEventRule,
  utilServiceRule,
];
