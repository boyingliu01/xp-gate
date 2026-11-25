import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import type { ProjectScope, DependencyScope } from './types';

/**
 * Options for the scope scanner.
 */
export interface ScanOptions {
  /** Root directory of the project */
  projectRoot: string;
  /** List of import paths to classify */
  imports: string[];
  /** Boundary patterns (glob-style) that define the project boundary */
  boundary: string[];
}

/**
 * Convert a glob pattern to a RegExp.
 * - `**` matches across directory separators → `.*`
 * - `*` matches within a single path segment → `[^/]*`
 *
 * @param pattern - Glob pattern to convert
 * @returns RegExp equivalent of the glob pattern
 */
type GlobCharResult = { regex: string; advance: number };

/** Single-character glob tokens and the regex each becomes. */
const GLOB_CHAR_TOKENS: Record<string, string> = {
  '*': '[^/]*',
  '.': '\\.',
  '?': '[^/]',
  '/': '/',
};

/** `**` spans directories; a bare `*` does not. */
const GLOBSTAR = '.*';

/** Regex metacharacters that match themselves literally in a glob. */
const REGEX_SPECIALS = '.+^${}()|[]\\';

/**
 * Translate one glob character.
 *
 * `**` is checked first and consumed whole: translating its two stars separately would
 * produce `[^/]*[^/]*`, which does NOT span a slash and silently fails to match any
 * nested path.
 */
function globCharToRegex(ch: string, nextCh: string): GlobCharResult {
  if (ch === '*' && nextCh === '*') return { regex: GLOBSTAR, advance: 2 };
  const token = GLOB_CHAR_TOKENS[ch];
  if (token) return { regex: token, advance: 1 };
  // A regex metacharacter is literal in a glob, so it must be escaped.
  return { regex: REGEX_SPECIALS.includes(ch) ? `\\${ch}` : ch, advance: 1 };
}

export function simpleGlobMatch(pattern: string, inputPath: string): boolean {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const result = globCharToRegex(pattern[i], pattern[i + 1] || '');
    regexStr += result.regex;
    i += result.advance;
  }

  try {
    const re = new RegExp(`^${regexStr}$`);
    return re.test(inputPath);
  } catch {
    return false;
  }
}

/**
 * Map of all Node.js built-in module names.
 */
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'http', 'https', 'crypto', 'stream',
  'events', 'util', 'url', 'querystring', 'assert', 'buffer',
  'child_process', 'cluster', 'dns', 'net', 'tls', 'readline',
  'process', 'v8', 'vm', 'zlib',
]);

/**
 * Check whether an import path is external (not part of the project).
 *
 * An import is considered external if:
 * 1. It is a Node.js built-in module
 * 2. It is a bare npm package (not starting with `.`, `/`, or `@/`)
 * 3. It matches any boundary pattern
 *
 * @param importPath - The import path to check
 * @param options - Scan options with boundary patterns
 * @returns `true` if the import is external
 */
/**
 * Whether a path is project-INTERNAL by its own shape, before patterns are consulted.
 *
 * Three forms, and each is a different reason: a relative path (`./x`, `../x`), the
 * project's `@/` alias, and an absolute path. None of them can name an npm package.
 */
function isInternalPath(importPath: string): boolean {
  return importPath.startsWith('.') || importPath.startsWith('@/') || isAbsolute(importPath);
}

/**
 * Whether a path is an external dependency.
 *
 * External when the path is a Node builtin, or when it is neither project-internal by
 * shape nor covered by a boundary pattern. A boundary pattern wins over the bare-name
 * heuristic, because a project may legitimately alias a package into its own tree.
 */
export function isExternalImport(importPath: string, options: ScanOptions): boolean {
  // Node builtins are always external, including the `node:` prefixed form.
  if (NODE_BUILTINS.has(importPath.replace(/^node:/, ''))) return true;
  if (isInternalPath(importPath)) return false;
  // A boundary pattern puts the path inside the project, whatever its shape looks like.
  return !options.boundary.some((pattern) => simpleGlobMatch(pattern, importPath));
}

/**
 * Resolve a `@/` path alias to a real file path.
 * `@/` maps to `src/` by default.
 *
 * @param importPath - Import path (may start with `@/`)
 * @param projectRoot - Root of the project
 * @returns Resolved absolute file path
 */
export function resolveToRealPath(importPath: string, projectRoot: string): string {
  const normalized = importPath.replace(/^@\//, 'src/');
  return resolve(projectRoot, normalized);
}

/**
 * Load external dependencies from the project's package.json.
 * Reads `dependencies`, `devDependencies`, and `peerDependencies`,
 * skipping `workspace:*` protocol packages.
 *
 * @param projectRoot - Root of the project
 * @returns Array of external package names
 */
/** The dependency fields of a `package.json` that name real external packages. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

/** The `workspace:` protocol marks an INTERNAL monorepo reference, not a package. */
const WORKSPACE_PROTOCOL = 'workspace:';

/**
 * The external package names a `package.json` declares.
 *
 * All three dependency fields count: a package that is only a devDependency is still
 * something the project imports. A `workspace:` version is skipped -- it points at a
 * sibling in the same monorepo, and treating it as external would report the project's
 * own code as a dependency.
 */
function externalPackageNames(pkg: Record<string, unknown>): string[] {
  // Merged, not concatenated: a package listed in BOTH `dependencies` and
  // `devDependencies` is one external package, and the scope report must not count it
  // twice.
  const merged = DEPENDENCY_FIELDS.reduce<Record<string, string>>(
    (acc, field) => ({ ...acc, ...((pkg[field] as Record<string, string>) ?? {}) }),
    {},
  );
  return Object.entries(merged)
    .filter(([, version]) => !String(version).startsWith(WORKSPACE_PROTOCOL))
    .map(([name]) => name);
}

export async function loadExternalDependencies(projectRoot: string): Promise<string[]> {
  const pkgPath = join(projectRoot, 'package.json');

  if (!existsSync(pkgPath)) {
    return [];
  }

  try {
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;

    const packages = externalPackageNames(pkg);

    return packages.sort();
  } catch {
    return [];
  }
}

/**
 * Check if an import path matches any module in a list.
 * Matches: exact name, subpath (ends with /module), or prefix (starts with module).
 */
function matchesModule(importPath: string, modules: string[]): boolean {
  return modules.some(
    (mod) => importPath === mod || importPath.endsWith('/' + mod) || importPath.startsWith(mod),
  );
}

/**
 * Check filesystem existence with optional cache.
 * Returns [exists, resolvedPath].
 */
function checkExists(
  importPath: string,
  projectRoot: string,
  existCache?: Map<string, boolean>,
): [boolean, string] {
  const resolved = resolveToRealPath(importPath, projectRoot);
  const exists = existCache?.get(resolved) ?? existsSync(resolved);
  if (existCache) existCache.set(resolved, exists);
  return [exists, resolved];
}

function isExternalPackage(importPath: string, packages: string[]): boolean {
  return packages.some(
    (pkg) => importPath === pkg || importPath.startsWith(pkg + '/'),
  );
}

/**
 * Classify a single dependency as internal, external, or pending.
 *
 * - **internal**: The import resolves to a file within the project boundary,
 *   or it's a relative/aliased import that exists on disk.
 * - **external**: The import is a Node.js builtin or npm package.
 * - **pending**: The import cannot be resolved yet (checked via existCache or filesystem).
 *
 * @param importPath - The import path to classify
 * @param scope - The project scope information
 * @param options - Scan options (used for boundary checks)
 * @param existCache - Cache of filesystem existence checks (path → boolean)
 * @returns The dependency scope classification
 */
/**
 * Internal when the file exists, PENDING when a boundary pattern claims it but nothing
 * is on disk yet.
 *
 * The two are deliberately different: "internal but missing" is a path the project owns
 * and has not written, while "external" would blame a package nobody added. PENDING is
 * what makes the scope report say "not done yet" instead of "not ours".
 */
function classifiedByExistence(
  importPath: string,
  options: ScanOptions,
  existCache: Map<string, boolean>,
): DependencyScope {
  const [exists] = checkExists(importPath, options.projectRoot, existCache);
  return exists ? 'internal' : 'pending';
}

export function classifyDependency(
  importPath: string,
  scope: ProjectScope,
  options: ScanOptions,
  existCache: Map<string, boolean> = new Map(),
): DependencyScope {
  const declared = declaredScope(importPath, scope);
  if (declared) return declared;
  if (options.boundary.some((pattern) => simpleGlobMatch(pattern, importPath))) {
    return classifiedByExistence(importPath, options, existCache);
  }
  if (isExternalImport(importPath, options)) return 'external';
  return classifiedByExistence(importPath, options, existCache);
}

/**
 * The scope a project DECLARATION gives this path, or null when none does.
 *
 * Explicit lists win over every heuristic, in this order: implemented modules are
 * internal, unimplemented ones are pending (declared but not written), known external
 * packages are external. A declaration is a stronger statement than any pattern.
 */
function declaredScope(importPath: string, scope: ProjectScope): DependencyScope | null {
  if (matchesModule(importPath, scope.implementedModules)) return 'internal';
  if (matchesModule(importPath, scope.unimplementedModules)) return 'pending';
  if (isExternalPackage(importPath, scope.externalPackages)) return 'external';
  return null;
}

function isAlreadyClassified(
  importPath: string,
  implemented: string[],
  unimplemented: string[],
  external: string[],
): boolean {
  return implemented.includes(importPath)
    || unimplemented.includes(importPath)
    || external.includes(importPath);
}

/**
 * Scan the project scope — classify a list of imports into
 * implemented, unimplemented, and external categories.
 *
 * Uses a filesystem existence cache (`existCache` Map) to
 * avoid repeated `existsSync` calls for the same path.
 *
 * @param options - Scan options
 * @returns The project scope with classified modules
 */
export async function scanProjectScope(options: ScanOptions): Promise<ProjectScope> {
  const { projectRoot, imports, boundary } = options;
  const existCache = new Map<string, boolean>();

  const implemented: string[] = [];
  const unimplemented: string[] = [];
  const external: string[] = [];

  for (const importPath of imports) {
    if (isAlreadyClassified(importPath, implemented, unimplemented, external)) continue;

    if (isExternalImport(importPath, options)) {
      external.push(importPath);
      continue;
    }

    const resolved = resolveToRealPath(importPath, projectRoot);
    const exists = existCache.get(resolved) ?? existsSync(resolved);
    existCache.set(resolved, exists);

    if (exists) {
      implemented.push(importPath);
    } else {
      unimplemented.push(importPath);
    }
  }

  return {
    implementedModules: [...new Set(implemented)],
    unimplementedModules: [...new Set(unimplemented)],
    externalPackages: [...new Set(external)],
    projectBoundary: [...boundary],
  };
}
