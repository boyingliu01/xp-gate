import { Severity } from '../../types';

/**
 * Helpers shared by the `arch.*` rules (#694, #699).
 *
 * Both rule families need the same three things: the package a file lives in,
 * the classes an adapter reports, and the severity the project configured.
 * Keeping them here means the two families cannot drift apart on what
 * "package segments" or "missing severity" means.
 */

/** One class as the adapters report it. */
export interface ClassFacts {
  name?: string;
  line?: number;
}

/** One import as the adapters report it. */
export interface ImportFacts {
  name?: string;
  line?: number;
  type?: string;
  used?: boolean;
}

/**
 * A Java source path reads `src/<zone>/java/<package...>/<File>.java`.
 * `JAVA_ZONE_OFFSET` is where `java` sits relative to `src`; `JAVA_ZONE_END_OFFSET`
 * is one past it, i.e. where the package segments begin.
 */
const JAVA_ZONE_OFFSET = 2;
const JAVA_ZONE_END_OFFSET = 3;

/**
 * The package segments of a Java file, derived from its PATH.
 *
 * Anchored on the LAST `src/main/java` or `src/test/java` occurrence, which is
 * what makes Maven multi-module work: in `core/domain/src/main/java/com/x/Y.java`
 * the package is `com.x`, not `core.domain`. Anchoring on the first occurrence
 * or on the start of the string would fold the module path into the package name
 * and every rule would go blind on multi-module projects.
 *
 * Returns `[]` when the path carries no Java source root, so a rule that only
 * matches known packages simply does not fire instead of guessing.
 */
export function extractPackageSegments(filePath: string): string[] {
  const normalised = filePath.replace(/\\/g, '/');
  const segments = normalised.split('/').filter((segment) => segment.length > 0);

  let sourceRoot = -1;
  for (let index = 0; index + JAVA_ZONE_OFFSET < segments.length; index += 1) {
    if (segments[index] === 'src' && segments[index + JAVA_ZONE_OFFSET] === 'java') {
      // Keep scanning: the LAST occurrence is the real source root in a
      // multi-module layout.
      sourceRoot = index + JAVA_ZONE_END_OFFSET;
    }
  }
  if (sourceRoot < 0) return [];

  // Drop the file name; what remains is the package.
  return segments.slice(sourceRoot, segments.length - 1);
}

/**
 * Whether a Java path is test code.
 *
 * `src/test/java` is excluded wholesale from the arch rules: a test may
 * legitimately be named anything, and reporting `UserControllerTest` because it
 * ends with `Test` and sits near `interfaces/rest` would be noise.
 */
export function isTestSource(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  return normalised.includes('/src/test/java/') || normalised.startsWith('src/test/java/');
}

/** The class names an adapter reports, skipping entries without a usable name. */
export function classNamesOf(adapter: unknown): Array<{ name: string; line?: number }> {
  const raw = (adapter as { extractClasses?: () => unknown[] }).extractClasses?.() ?? [];
  const named: Array<{ name: string; line?: number }> = [];
  for (const entry of raw) {
    const facts = entry as ClassFacts;
    if (typeof facts?.name === 'string' && facts.name.length > 0) {
      named.push({ name: facts.name, line: facts.line });
    }
  }
  return named;
}

/** The imports an adapter reports, skipping entries without a usable name. */
export function importsOf(adapter: unknown): Array<{ name: string; line?: number }> {
  const raw = (adapter as { imports?: unknown[] }).imports ?? [];
  const named: Array<{ name: string; line?: number }> = [];
  for (const entry of raw) {
    const facts = entry as ImportFacts;
    if (typeof facts?.name === 'string' && facts.name.length > 0) {
      named.push({ name: facts.name, line: facts.line });
    }
  }
  return named;
}

/**
 * Read one rule's severity from the active config, with a fallback.
 *
 * The arch group is new, so a project whose `.principlesrc` predates it has no
 * entry at all. Falling back keeps those projects working instead of throwing
 * on a missing key -- which is what AC-COMPAT-01 pins down.
 */
export function readSeverity(
  group: Record<string, { severity?: string }> | undefined,
  ruleKey: string,
  fallback: Severity,
): Severity {
  const configured = group?.[ruleKey]?.severity;
  if (configured === 'error' || configured === 'warning' || configured === 'info') {
    return configured;
  }
  return fallback;
}

/** The simple class name of a fully-qualified name (`a.b.UserService` -> `UserService`). */
export function simpleNameOf(fullyQualified: string): string {
  const lastDot = fullyQualified.lastIndexOf('.');
  return lastDot >= 0 ? fullyQualified.slice(lastDot + 1) : fullyQualified;
}

/** The package segments of a fully-qualified name (`a.b.C` -> ['a','b']). */
export function packageSegmentsOf(fullyQualified: string): string[] {
  const parts = fullyQualified.split('.');
  // The last part is the type name, not a package.
  return parts.length > 1 ? parts.slice(0, parts.length - 1) : [];
}
