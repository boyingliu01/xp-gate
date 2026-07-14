/**
 * Sprint state discovery module.
 *
 * Scans .worktrees/sprint/ subdirectories under a git repository root
 * to discover active sprint states. Consumed by:
 *   - CLI: src/npm-package/lib/sprint-status.js (CommonJS)
 *   - TUI: plugins/opencode/tui-plugin.ts   (inlined logic, this is the canonical source)
 *
 * Single source of truth for sprint discovery logic.
 *
 * @module sprint-discovery
 */

const fs = require('fs');
const path = require('path');
const { SprintStateManager } = require('./sprint-state-manager');

/**
 * Maximum number of active sprints to return.
 * TUI displays top 3 (rest collapsed), CLI --all can show all.
 */
const MAX_RESULTS = 5;

/**
 * Walk upward from startDir to find the git repository root
 * (first parent directory containing a .git/ subdirectory).
 *
 * @param {string} startDir - Starting directory
 * @returns {string|null} Git root path, or null if not found
 */
function findGitRoot(startDir) {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  const seen = new Set();

  while (current !== root) {
    if (seen.has(current)) break; // symlink loop guard
    seen.add(current);

    const gitPath = path.join(current, '.git');
    try {
      if (fs.existsSync(gitPath)) {
        return current;
      }
    } catch {
      // EACCES or other filesystem error — skip this level
    }

    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  // Check root level too
  try {
    if (fs.existsSync(path.join(root, '.git'))) return root;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Read and parse a sprint-state.json from a given project directory.
 * Uses SprintStateManager for schema validation + auto-migration.
 *
 * @param {string} dir - Directory containing .sprint-state/
 * @returns {object|null} Parsed sprint state, or null if not found or malformed
 */
function readSprintState(dir) {
  try {
    const manager = new SprintStateManager(dir);
    return manager.read();
  } catch {
    return null;
  }
}

/**
 * Check if a worktree directory still exists on disk.
 *
 * @param {string} worktreePath - Path to worktree root
 * @returns {boolean}
 */
function checkWorktreeExists(worktreePath) {
  if (!worktreePath) return false;
  try {
    return fs.existsSync(worktreePath);
  } catch {
    return false;
  }
}

/**
 * Discover all active sprint states from a project directory.
 *
 * Discovery flow:
 * 1. Walk upward from dir to find git root (look for .git/)
 * 2. In git root, scan .worktrees/sprint/ subdirectories
 * 3. For each sprint-* dir, read .sprint-state/sprint-state.json (per-entry try/catch)
 * 4. Also read the original dir's own .sprint-state/ (compat with non-worktree mode)
 * 5. Deduplicate by state.id, preferring worktree version
 * 6. Filter out completed sprints with deleted worktrees
 * 7. Sort by started_at descending, secondary sort by id descending
 * 8. Cap at MAX_RESULTS
 *
 * @param {string} dir - Starting directory (typically process.cwd())
 * @returns {Array<{ state: object, sourcePath: string, worktreeExists: boolean }>}
 */
function discoverActiveSprints(dir) {
  const gitRoot = findGitRoot(dir);
  const results = [];

  // ── 1. Scan .worktrees/sprint/ subdirectories ──
  if (gitRoot) {
    const worktreeBase = path.join(gitRoot, '.worktrees', 'sprint');
    let entries = [];
    try {
      if (fs.existsSync(worktreeBase)) {
        entries = fs.readdirSync(worktreeBase, { withFileTypes: true });
      }
    } catch {
      // EACCES or other error — skip worktree scanning
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sprintDir = path.join(worktreeBase, entry.name);
      const state = readSprintState(sprintDir);
      if (!state || !state.id) continue; // skip corrupted or anonymous sprints

      const worktreeExists = checkWorktreeExists(sprintDir);

      // Filter: completed sprints with deleted worktrees are orphans
      if (state.status === 'completed' && !worktreeExists) continue;

      // Filter: in_progress sprints with deleted worktrees are stale orphans
      if ((state.status === 'in_progress' || state.status === 'running') && !worktreeExists) continue;

      results.push({
        state,
        sourcePath: path.join(sprintDir, '.sprint-state', 'sprint-state.json'),
        worktreeExists,
      });
    }
  }

  // ── 2. Fallback: read from the original dir's .sprint-state/ ──
  const localState = readSprintState(dir);
  if (localState && localState.id) {
    const localWorktreePath = localState.isolation?.worktree_path;
    const localWorktreeExists = localWorktreePath ? checkWorktreeExists(localWorktreePath) : false;

    // Only filter as orphan if sprint explicitly references a worktree
    // that no longer exists. If no worktree_path at all, assume valid.
    const hasExplicitWorktree = !!localWorktreePath;
    if (!hasExplicitWorktree || localWorktreeExists) {
      results.push({
        state: localState,
        sourcePath: path.join(dir, '.sprint-state', 'sprint-state.json'),
        worktreeExists: localWorktreeExists,
      });
    }
  }

  // ── 3. Deduplicate by state.id ──
  // Prefer worktree version (worktreeExists=true) over cwd fallback.
  // Tie-breaker for same-id worktrees: latest started_at wins;
  // if timestamps equal, lexicographically smallest sourcePath wins.
  const deduped = new Map();
  for (const entry of results) {
    const id = entry.state.id;
    const existing = deduped.get(id);
    if (!existing) {
      deduped.set(id, entry);
      continue;
    }

    // Prefer worktree version over cwd fallback
    if (entry.worktreeExists && !existing.worktreeExists) {
      deduped.set(id, entry);
      continue;
    }
    if (!entry.worktreeExists && existing.worktreeExists) {
      continue; // keep existing worktree version
    }

    // Both worktree or both cwd: tie-break by started_at
    const entryTs = entry.state.started_at ? new Date(entry.state.started_at).getTime() : 0;
    const existingTs = existing.state.started_at ? new Date(existing.state.started_at).getTime() : 0;

    if (entryTs > existingTs) {
      deduped.set(id, entry);
    } else if (entryTs === existingTs && entry.sourcePath < existing.sourcePath) {
      deduped.set(id, entry);
    }
  }

  // ── 4. Sort by started_at descending, then id descending ──
  const sorted = Array.from(deduped.values()).sort((a, b) => {
    const aTs = a.state.started_at ? new Date(a.state.started_at).getTime() : 0;
    const bTs = b.state.started_at ? new Date(b.state.started_at).getTime() : 0;
    if (bTs !== aTs) return bTs - aTs;
    // Secondary sort: id descending for deterministic order
    return String(b.state.id).localeCompare(String(a.state.id));
  });

  // ── 5. Cap at MAX_RESULTS ──
  return sorted.slice(0, MAX_RESULTS);
}

module.exports = {
  discoverActiveSprints,
  findGitRoot,
  readSprintState,
  MAX_RESULTS,
};
