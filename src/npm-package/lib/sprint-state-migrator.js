/**
 * Sprint State Migrator — legacy phase migration + rollback helpers.
 *
 * Extracted from SprintStateManager to satisfy god-class rule (≤15 methods).
 *
 * @module sprint-state-migrator
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Legacy phase number → v1 phase mapping
 */
const LEGACY_PHASE_MAP = {
  '-1': { phase: 1, phase_name: 'PREP' },
  '-0.5': { phase: 1, phase_name: 'PREP' },
  '0': { phase: 2, phase_name: 'DESIGN' },
  '1': { phase: 2, phase_name: 'DESIGN' },
  '2': { phase: 3, phase_name: 'BUILD' },
  '3': { phase: 4, phase_name: 'VERIFY' },
  '4': { phase: 4, phase_name: 'VERIFY' },
  '5': { phase: 5, phase_name: 'SHIP' },
  '6': { phase: 5, phase_name: 'SHIP' },
  '7': { phase: 6, phase_name: 'CLOSE' },
  '8': { phase: 6, phase_name: 'CLOSE' },
};

const PHASE_NAMES = ['PREP', 'DESIGN', 'BUILD', 'VERIFY', 'SHIP', 'CLOSE'];

/**
 * Migrate legacy sprint-state.json to v1 schema.
 *
 * @param {Object} state - Raw state from file
 * @param {string} stateDir - Path to .sprint-state directory
 * @returns {Object} Migrated state with _schema_version: 1
 */
function migrateState(state, stateDir) {
  const warnings = [];

  state._schema_version = 1;

  if (!state.task_description) {
    state.task_description = '-';
    warnings.push('task_description was missing, set to "-"');
  }

  if (!state.id) {
    state.id = `sprint-${Date.now()}`;
    warnings.push('id was missing, generated from timestamp');
  }

  if (!state.status) { state.status = 'in_progress'; }
  if (!state.started_at) { state.started_at = new Date().toISOString(); }
  if (!state.phase_history) { state.phase_history = []; }
  if (!state.isolation) { state.isolation = { worktree_path: null, branch: null }; }

  state.phase_history = state.phase_history.map(entry => {
    const phaseNum = String(entry.phase);
    const mapped = LEGACY_PHASE_MAP[phaseNum];
    if (mapped) {
      warnings.push(`Migrated legacy phase ${entry.phase} → ${mapped.phase} (${mapped.phase_name})`);
      return { ...entry, phase: mapped.phase, phase_name: mapped.phase_name };
    }
    if (!entry.phase_name && entry.phase >= 1 && entry.phase <= 6) {
      entry.phase_name = PHASE_NAMES[entry.phase - 1];
    }
    return entry;
  });

  const currentPhaseNum = String(state.phase);
  const currentMapped = LEGACY_PHASE_MAP[currentPhaseNum];
  if (currentMapped) {
    state.phase = currentMapped.phase;
    warnings.push(`Migrated current phase ${currentPhaseNum} → ${currentMapped.phase}`);
  }

  state.phase_history = state.phase_history.map(entry => {
    if (entry.timestamp && !entry.started_at) {
      entry.started_at = entry.timestamp;
    }
    return entry;
  });

  if (warnings.length > 0) {
    logMigrationWarnings(warnings, stateDir);
  }

  return state;
}

/**
 * Create initial sprint state for new sprints.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Initial state
 */
function createInitialState(projectRoot) {
  return {
    _schema_version: 1,
    evidence_schema_version: 2,
    id: `sprint-${Date.now()}`,
    task_description: '-',
    phase: 1,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    phase_history: [],
    isolation: { worktree_path: projectRoot, branch: null },
    outputs: {},
    metrics: {},
  };
}

/**
 * Log migration warnings to file.
 *
 * @param {string[]} warnings - Array of warning messages
 * @param {string} stateDir - Path to .sprint-state directory
 */
function logMigrationWarnings(warnings, stateDir) {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const warningsFile = path.join(stateDir, 'migration-warnings.json');
  const existing = fs.existsSync(warningsFile)
    ? JSON.parse(fs.readFileSync(warningsFile, 'utf8'))
    : [];

  existing.push({ timestamp: new Date().toISOString(), warnings });
  fs.writeFileSync(warningsFile, JSON.stringify(existing, null, 2), 'utf8');
}

/**
 * Rollback to backup state.
 *
 * @param {string} stateFile - Path to sprint-state.json
 * @param {string} backupFile - Path to sprint-state.json.backup
 * @returns {boolean} True if rollback succeeded
 */
function rollbackState(stateFile, backupFile) {
  if (!fs.existsSync(backupFile)) { return false; }
  fs.copyFileSync(backupFile, stateFile);
  return true;
}

module.exports = {
  LEGACY_PHASE_MAP,
  migrateState,
  createInitialState,
  rollbackState,
};
