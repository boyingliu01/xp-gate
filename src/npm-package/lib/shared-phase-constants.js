/**
 * Shared Sprint Flow phase constants.
 *
 * Single source of truth for PHASE_NAMES and PHASE_ORDER, consumed by both
 * the CLI (sprint-status.js, CommonJS) and the OpenCode TUI plugin
 * (tui-plugin.ts, ESM via tsx).
 *
 * @module shared-phase-constants
 */

const PHASE_NAMES = {
  '-1': 'ISOLATE',
  '-0.5': 'AUTO-ESTIMATE',
  '0': 'THINK',
  '1': 'PLAN',
  '2': 'BUILD',
  '3': 'REVIEW',
  '4': 'USER ACCEPT',
  '5': 'FEEDBACK',
  '6': 'SHIP',
  '7': 'LAND',
  '8': 'CLEANUP',
};

const PHASE_ORDER = ['-1', '-0.5', '0', '1', '2', '3', '4', '5', '6', '7', '8'];

/**
 * Find the most recent timestamp across started_at and phase_history.
 * @param {object} state - Sprint state object
 * @returns {number} Latest timestamp in ms, or 0 if none found
 */
function getLatestTimestamp(state) {
  if (!state || !state.started_at) return 0;
  const started = new Date(state.started_at).getTime();
  if (isNaN(started)) return 0;
  let latest = started;
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      if (ph.completed_at) {
        const t = new Date(ph.completed_at).getTime();
        if (!isNaN(t) && t > latest) latest = t;
      }
      if (ph.started_at) {
        const t = new Date(ph.started_at).getTime();
        if (!isNaN(t) && t > latest) latest = t;
      }
    }
  }
  return latest;
}

/**
 * Check if the sprint state is stale (>1h since last activity).
 * @param {object} state - Sprint state object
 * @returns {boolean}
 */
function isStale(state) {
  if (!state || !state.started_at) return false;
  const latest = getLatestTimestamp(state);
  return latest > 0 && Date.now() - latest > 3600000;
}

module.exports = { PHASE_NAMES, PHASE_ORDER, getLatestTimestamp, isStale };
