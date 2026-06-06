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
export function simpleGlobMatch(pattern: string, inputPath: string): boolean {
  // Escape regex special characters except for * and **
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches everything including path separators
      regexStr += '.*';
      i += 2;
    } else if (ch === '*') {
      // Single * matches any chars except path separator
      regexStr += '[^/]*';
      i += 1;
    } else if (ch === '.') {
      regexStr += '\\.';
      i += 1;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if (ch === '/') {
      regexStr += '/';
      i += 1;
    } else {
      // Escape other special regex chars
      const special = '.+^${}()|[]\\';
      if (special.includes(ch)) {
        regexStr += '\\' + ch;
      } else {
        regexStr += ch;
      }
      i += 1;
    }
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
export function isExternalImport(importPath: string, options: ScanOptions): boolean {
  // Node.js builtins are always external
  const bareName = importPath.startsWith('node:') ? importPath.slice(5) : importPath;
  if (NODE_BUILTINS.has(bareName)) {
    return true;
  }

  // Relative imports (starting with .) are internal
  if (importPath.startsWith('.')) {
    return false;
  }

  // @/ alias is internal (project path alias)
  if (importPath.startsWith('@/')) {
    return false;
  }

  // Absolute imports (Unix /... or Windows C:\...) are internal
  if (isAbsolute(importPath)) {
    return false;
  }

  // Check boundary patterns — if any pattern matches, it's within the project boundary
  for (const pattern of options.boundary) {
    if (simpleGlobMatch(pattern, importPath)) {
      return false;
    }
  }

  // Bare import (npm package) — external
  return true;
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
export async function loadExternalDependencies(projectRoot: string): Promise<string[]> {
  const pkgPath = join(projectRoot, 'package.json');

  if (!existsSync(pkgPath)) {
    return [];
  }

  try {
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;

    const deps: Record<string, string> = pkg.dependencies as Record<string, string> || {};
    const devDeps: Record<string, string> = pkg.devDependencies as Record<string, string> || {};
    const peerDeps: Record<string, string> = pkg.peerDependencies as Record<string, string> || {};

    const allDeps = { ...deps, ...devDeps, ...peerDeps };
    const packages: string[] = [];

    for (const [name, version] of Object.entries(allDeps)) {
      // Skip workspace:* protocol packages — they are internal monorepo references
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        continue;
      }
      packages.push(name);
    }

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
export function classifyDependency(
  importPath: string,
  scope: ProjectScope,
  options: ScanOptions,
  existCache: Map<string, boolean> = new Map(),
): DependencyScope {
  if (matchesModule(importPath, scope.implementedModules)) return 'internal';
  if (matchesModule(importPath, scope.unimplementedModules)) return 'pending';
  if (isExternalPackage(importPath, scope.externalPackages)) return 'external';

  for (const pattern of options.boundary) {
    if (simpleGlobMatch(pattern, importPath)) {
      const [exists] = checkExists(importPath, options.projectRoot, existCache);
      if (exists) return 'internal';
      return 'pending';
    }
  }

  if (isExternalImport(importPath, options)) return 'external';

  const [exists] = checkExists(importPath, options.projectRoot, existCache);
  if (exists) return 'internal';
  return 'pending';
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
