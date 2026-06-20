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
 * Safely parse a date-like value into epoch ms.
 * @param {*} value - Timestamp to parse
 * @returns {number} Epoch ms, or NaN if invalid
 */
function parseTime(value) {
  return new Date(value).getTime();
}

/**
 * Get the max of an existing value and a new timestamp (if valid and larger).
 * @param {number} current - Current best value
 * @param {*} candidate - Candidate timestamp
 * @returns {number} Max value
 */
function maxValid(current, candidate) {
  if (!candidate) return current;
  const t = parseTime(candidate);
  return !isNaN(t) && t > current ? t : current;
}

/**
 * Find the most recent timestamp across started_at and phase_history.
 * @param {object} state - Sprint state object
 * @returns {number} Latest timestamp in ms, or 0 if none found
 */
function getLatestTimestamp(state) {
  if (!state || !state.started_at) return 0;
  const started = parseTime(state.started_at);
  if (isNaN(started)) return 0;
  let latest = started;
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      latest = maxValid(maxValid(latest, ph.completed_at), ph.started_at);
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
