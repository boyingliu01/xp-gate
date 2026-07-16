/**
 * Shared sprint state I/O — read/write sprint-state.json.
 *
 * Delegates to SprintStateManager for schema validation + auto-migration.
 * Re-exports SprintState type for TypeScript consumers.
 *
 * @test REQ-002 Token 差分采集器
 * @intent 提供 sprint-state.json 的共享读写函数，委托给 SprintStateManager
 * @covers AC-002-01
 */

const { SprintStateManager } = require('../npm-package/lib/sprint-state-manager');

/**
 * Sprint state shape — matches SprintStateManager v1 schema.
 * Re-exported for TypeScript consumers (sprint-recorder, token-delta, span-tracer).
 */
export interface SprintState {
  _schema_version?: 1;
  id?: string;
  task_description?: string;
  phase?: number;
  status?: 'in_progress' | 'paused' | 'completed';
  started_at?: string;
  phase_history?: Array<{
    phase: number;
    phase_name: string;
    status: string;
    started_at?: string;
    completed_at?: string;
    duration_seconds?: number;
    timestamp?: string; // Legacy field, migrated to started_at
    reqs?: Record<string, { name: string; status: string }>;
  }>;
  isolation?: { worktree_path: string | null; branch: string | null };
  outputs?: Record<string, string>;
  metrics?: Record<string, unknown>;
  auto_estimate?: Record<string, unknown>;
}

/**
 * Read sprint-state.json with schema validation + auto-migration.
 * Delegates to SprintStateManager.
 */
export function readSprintState(root: string): SprintState | null {
  try {
    const manager = new SprintStateManager(root);
    return manager.read() as SprintState | null;
  } catch {
    return null;
  }
}

/**
 * Write sprint-state.json with atomic write.
 * Delegates to SprintStateManager.
 */
export function writeSprintState(root: string, state: SprintState): void {
  const manager = new SprintStateManager(root);
  manager.write(state);
}
