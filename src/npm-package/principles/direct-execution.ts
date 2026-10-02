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
 * The comparison itself is the only reliable one: resolved file URL of argv[1]
 * against the caller's own module URL. `pathToFileURL` normalises win32 drive
 * letters, backslashes, and percent-encoding, so it works on Windows and POSIX.
 */
export function isDirectExecution(
  argv1: string | undefined,
  metaUrl: string | undefined,
): boolean {
  // CJS path: `require.main === module` is exact and needs no URL work.
  if (typeof require !== 'undefined' && require.main === module) {
    return true;
  }
  if (!metaUrl || !argv1) {
    return false;
  }
  try {
    return pathToFileURL(resolve(argv1)).href === metaUrl;
  } catch {
    // An unparsable argv[1] is not an entry point; never throw from a guard.
    return false;
  }
}
