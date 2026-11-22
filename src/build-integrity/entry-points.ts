import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Entry-point reachability for Gate 9's pack check.
 *
 * Extracted from `gate-10.ts` when that file crossed the 1050-line limit that
 * Gate 4's `clean-code.large-file` rule enforces — the same reason and the same
 * shape as the `quote-masker.ts` split beside this file. The seam is real:
 * nothing here knows about tsc, npm, git or gates. It answers one question —
 * given a manifest and a list of shipped paths, which declared entry points are
 * absent from the package?
 *
 * WHY THE QUESTION NEEDS ASKING
 *
 * `npm pack --dry-run` reports which files WOULD publish. That is not the same as
 * "the package can be used". Measured 2026-11-22 on a project declaring
 *
 *     { "main": "dist/nonexistent.js", "files": ["dist"] }
 *
 * whose dist/ held only `tsconfig.tsbuildinfo`. npm shipped that file plus
 * `package.json`; the existing check only required "at least one file that is not
 * package.json", so it passed. The resulting tarball contains no JavaScript, and
 * every `require()` of the published package would throw MODULE_NOT_FOUND.
 *
 * A manifest that disagrees with its own contents is the defect the
 * build-integrity gate is named for, so it belongs to gate 9 rather than to a
 * general packaging audit.
 */

/**
 * Collect every string leaf of an entry-point field, including nested objects.
 *
 * `exports` is the reason for the recursion: it is usually
 * `{ ".": { "require": "./dist/a.js", "types": "./dist/a.d.ts" } }`, and the
 * strings that matter are two levels down.
 */
function collectEntryLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectEntryLeaves(nested, out);
  }
}

/** Strip a leading "./" or "/" so a declared entry becomes a package-relative path. */
function toPackageRelative(raw: string): string {
  return raw.replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Whether a declared entry points into THIS package at all.
 *
 * `main` is conventionally written WITHOUT a leading "./" — "dist/index.js" is
 * the normal form — so the prefix is stripped rather than required. Requiring it
 * is the bug this module already had once: every real manifest was filtered out
 * and the check silently evaluated nothing while reporting success.
 *
 * A bare name with no slash is a dependency resolved inside node_modules, not a
 * path in the tarball, so it is not this module's business.
 */
function isPackageRelativeEntry(raw: string): boolean {
  const rel = toPackageRelative(raw);
  if (rel === '' || rel === '.') return false;
  if (!rel.includes('/') && !/\.[a-z0-9]+$/i.test(rel)) return false;
  return true;
}

/**
 * The paths npm would accept for a declared entry.
 *
 * Covers extension and directory resolution so an ordinary extensionless manifest
 * ("main": "dist/index") is not a false block — npm resolves both of those, and a
 * checker that did not would reject correct packages.
 */
function entryCandidates(raw: string): string[] {
  const rel = toPackageRelative(raw);
  return [
    rel,
    `${rel}.js`,
    `${rel}.mjs`,
    `${rel}.cjs`,
    `${rel}.d.ts`,
    `${rel}/index.js`,
    `${rel}/index.mjs`,
  ];
}

/** The fields npm treats as package entry points. */
const ENTRY_FIELDS = ['main', 'module', 'types', 'exports'] as const;

/**
 * Declared entry points that will not exist once the package is installed.
 *
 * Returns the original spelling of each absent entry so the operator can find it
 * in package.json. An empty array means every declared entry is really shipped.
 */
export function missingEntryPoints(
  manifest: Record<string, unknown>,
  presentPaths: Set<string>
): string[] {
  const declared: string[] = [];
  for (const field of ENTRY_FIELDS) {
    collectEntryLeaves(manifest[field], declared);
  }
  return declared
    .filter(isPackageRelativeEntry)
    .filter((raw) => !entryCandidates(raw).some((c) => presentPaths.has(c)));
}

/**
 * The operator-facing message when a manifest names files the tarball lacks, or
 * null when every declared entry is really shipped.
 */
export function unreachableEntryPointsMessage(
  manifest: Record<string, unknown>,
  files: Array<{ path: string }>
): string | null {
  const present = new Set(files.map((f) => f.path));
  const missing = missingEntryPoints(manifest, present);
  if (missing.length === 0) return null;
  return `package.json declares ${missing.length} entry point(s) the package does not contain: ${missing.join(', ')}`;
}

/**
 * Read a package manifest, or null when it is absent or unparseable.
 *
 * A missing manifest is not an error here -- it means there is nothing to
 * reconcile, which is the same situation as a manifest with no entry fields.
 */
export async function readManifest(projectRoot: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
