import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Decide whether the calling module is the process entry point.
 *
 * Why this exists: the previous check in `boy-scout.ts` was
 * `process.argv[1]?.includes('boy-scout')`, which is wrong in both directions.
 * It fires for any unrelated path that happens to contain the substring (e.g.
 * `/tmp/boy-scout-notes/run.ts`), and it fails to fire when the real script is
 * invoked through a path that does not repeat the filename -- which is exactly
 * what happens under CI, where argv[1] is the test runner's path. The CLI then
 * silently does nothing and prints nothing (#453).
 *
 * IMPORTANT -- pass `metaUrl` explicitly. `import.meta.url` is evaluated where
 * it is *written*, so a default of `import.meta.url` inside this shared module
 * captures THIS file's URL, not the caller's, and every guard would return false.
 * Callers must use `isDirectExecution(process.argv[1], import.meta.url)`.
 *
 * Both sides are realpath'd before comparison. Node resolves ESM module URLs
 * through symlinks, while `argv[1]` keeps whatever path the caller typed -- so a
 * bin shim, `npm link`, or a symlinked checkout compares unequal without this and
 * the CLI silently no-ops, which is the same failure class as #453.
 */
export function isDirectExecution(
  argv1: string | undefined,
  metaUrl: string | undefined,
): boolean {
  if (isCommonJsMain()) return true;
  if (!metaUrl || !argv1) return false;
  return runsAsEsmEntry(argv1, metaUrl);
}

/**
 * Whether this module IS the CommonJS main module.
 *
 * `require.main === module` is exact. It is guarded by `typeof require` rather than
 * called bare: under ESM the whole expression is inert, and a bare `require.main` would
 * throw ReferenceError at module load.
 */
function isCommonJsMain(): boolean {
  return typeof require !== 'undefined' && require.main === module;
}

/**
 * Whether argv[1] resolves to the same file as this ESM module.
 *
 * Both sides are CANONICALISED, because the same file has several spellings (a relative
 * path, a `file://` URL, a symlinked path) and comparing raw strings would miss a real
 * match. An unparsable argv[1] is not an entry point -- a guard must never throw.
 */
function runsAsEsmEntry(argv1: string, metaUrl: string): boolean {
  try {
    return canonical(pathToFileURL(resolve(argv1)).href) === canonical(metaUrl);
  } catch {
    return false;
  }
}

/**
 * Resolve a file URL to its real path so symlinked and non-symlinked spellings of
 * the same file compare equal. Falls back to the input when the path does not
 * exist (a guard must not throw) -- an unresolvable URL simply will not match.
 */
function canonical(fileUrl: string): string {
  try {
    return pathToFileURL(realpathSync(new URL(fileUrl))).href;
  } catch {
    return fileUrl;
  }
}
