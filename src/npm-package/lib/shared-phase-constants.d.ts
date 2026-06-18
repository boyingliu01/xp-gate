/**
 * Type declarations for shared-phase-constants (CommonJS module).
 * Consumed by both sprint-status.js (CJS) and tui-plugin.ts (ESM via tsx).
 */

export const PHASE_NAMES: Record<string, string>;
export const PHASE_ORDER: string[];

/**
 * Find the most recent timestamp across started_at and phase_history.
 */
export function getLatestTimestamp(state: object): number;

/**
 * Check if the sprint state is stale (>1h since last activity).
 */
export function isStale(state: object): boolean;
