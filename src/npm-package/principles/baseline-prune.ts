/**
 * Stale-entry pruning for `.warnings-baseline.json` (#452 REQ-3).
 *
 * `classifyFiles` in boy-scout.ts has always parsed the git `D` status into a
 * `deleted` list, but nothing consumed it, so the baseline accumulated entries
 * for files that no longer exist. A stale entry is not merely untidy: if a path
 * is later re-created it inherits the old allowance, and the Boy Scout gate then
 * compares against a phantom history.
 *
 * Lives in its own module because boy-scout.ts is already at the 10-export
 * clean-code.many-exports limit.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

/** Outcome of a baseline prune: which entries survived, and which were dropped. */
export interface PruneResult {
  /** Baseline keys confirmed to still exist (or that we could not disprove). */
  kept: string[];
  /** Baseline keys safe to drop: absent from disk AND no longer tracked by git. */
  removed: string[];
  /** Set when the baseline could not be parsed; nothing is removed in that case. */
  error?: string;
}

/**
 * Identify baseline entries whose file no longer exists.
 *
 * REMOVAL IS DOUBLE-CONFIRMED, on purpose. Both signals are wrong on their own:
 *   - `existsSync` alone: a sparse checkout, a mid-flight rebase, a symlinked
 *     worktree, or a case-insensitive filesystem all make a live tracked file
 *     look absent.
 *   - `git ls-files` alone: a file can be present but deliberately untracked.
 * So an entry is dropped only when the path is missing from disk AND git reports
 * it untracked. If git cannot be consulted at all, everything is kept -- failing
 * closed retains a legitimate allowance, whereas failing open would discard one.
 *
 * Pure with respect to `baselineJson`: the caller decides when to persist.
 */
export function pruneBaselineEntries(baselineJson: string, projectRoot: string): PruneResult {
  const files = parseBaselineFiles(baselineJson);
  if (typeof files === 'string') {
    return { kept: [], removed: [], error: files };
  }

  const tracked = listTrackedFiles(projectRoot);
  const kept: string[] = [];
  const removed: string[] = [];

  for (const key of Object.keys(files)) {
    if (isEntryStale(key, projectRoot, tracked)) {
      removed.push(key);
    } else {
      kept.push(key);
    }
  }

  return { kept, removed };
}

/**
 * Extract the path -> entry map, or a string describing why it is unusable.
 *
 * The on-disk format is a FLAT map (`{"src/a.ts": {totalWarnings, lastAnalyzed}}`),
 * not a `{files: {...}}` wrapper. A `files` wrapper is still accepted for forwards
 * compatibility, but the flat form is what `saveBaseline` actually writes.
 */
function parseBaselineFiles(baselineJson: string): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(baselineJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Fail safe: an unparsable baseline must never be reported as "all stale",
    // which is exactly how the reporter's entries disappeared.
    return `could not parse baseline: ${detail}`;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'baseline is not a JSON object';
  }

  const record = parsed as Record<string, unknown>;
  const nested = record.files;
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  // Keep only object-valued keys: scalars at the top level are metadata, not
  // path entries, and a path whose entry is a bare number is the malformed shape
  // that assertValidEntry rejects elsewhere (#455).
  const entries: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      entries[key] = value;
    }
  }
  return entries;
}

/**
 * Whether a baseline key is safe to drop.
 *
 * `tracked === null` means git was unavailable, in which case nothing is stale.
 */
function isEntryStale(key: string, projectRoot: string, tracked: Set<string> | null): boolean {
  if (tracked === null) return false;
  if (tracked.has(normalizeBaselinePath(key))) return false;
  try {
    return !existsSync(resolve(projectRoot, key));
  } catch {
    // If the filesystem cannot answer, keep the entry.
    return false;
  }
}

/**
 * Canonical form for comparing a baseline key with a git index path.
 *
 * The git index is authoritative for casing and separators, so both sides are
 * lowercased with `/` separators. Without this, a Windows checkout that records
 * `Src/A.ts` would not match a baseline key of `src/A.ts` and the entry would be
 * wrongly deleted.
 */
function normalizeBaselinePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/** Tracked paths per the git index, or null when git cannot be consulted. */
function listTrackedFiles(projectRoot: string): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const set = new Set<string>();
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) set.add(normalizeBaselinePath(trimmed));
    }
    return set;
  } catch {
    return null;
  }
}
