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

/**
 * Whether a Java path is one the arch rules CANNOT judge because its layout is
 * not recognised.
 *
 * `extractPackageSegments()` returns `[]` for such a path, and every rule then
 * finds nothing to report -- which is indistinguishable, from the outside, from
 * a file that was examined and found clean. That is the failure mode the
 * feasibility seat raised in Round 2: a project using a custom source set (or a
 * flat `java/com/...` tree) gets a silent zero. The extraction must stay empty
 * (guessing a package would invent findings), so the skip has to be reportable
 * on its own.
 *
 * Scope is deliberately the JVM languages (`.java`, `.kt`, `.kts`) even though
 * the name says Java: the arch rules never look at anything else, and flagging
 * a `.ts` path as "unrecognised Java layout" would bury the real signal in
 * noise. The name is kept because every call site is a Java rule.
 *
 * A file in the default package (no `package` declaration) also lands here. That
 * is intended: such a project has no package path for these rules to judge, so
 * "not examined" is the honest answer and "no violations" is not.
 *
 * LIMITATION (accepted for this change, tracked for follow-up): this is a
 * symptom-level diagnostic, not a fix. The durable answer is a source-root
 * resolver that understands custom source sets; until then a custom layout is
 * reported as skipped rather than silently passing. Only the naming rules emit
 * this diagnostic today -- the dependency rules read imports and class names,
 * not package segments, so they have no equivalent blind spot to report.
 *
 * @param filePath repository-relative or absolute path
 * @returns true when the file is a JVM source AND its source root is unreadable
 */
export function isUnrecognisedJavaLayout(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  if (!/\.(java|kt|kts)$/i.test(normalised)) return false;
  return extractPackageSegments(normalised).length === 0;
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
