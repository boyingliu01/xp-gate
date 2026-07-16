/**
 * Sprint State Manager — centralized read/write/transition for sprint state.
 *
 * Resolves #343 (schema drift) and #338 (auto-render enforcement).
 *
 * @module sprint-state-manager
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { migrateState, createInitialState, rollbackState, LEGACY_PHASE_MAP } = require('./sprint-state-migrator');

class SprintStateManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.stateDir = path.join(projectRoot, '.sprint-state');
    this.stateFile = path.join(this.stateDir, 'sprint-state.json');
    this.backupFile = path.join(this.stateDir, 'sprint-state.json.backup');
  }

  read() {
    if (!fs.existsSync(this.stateFile)) {
      return null;
    }

    const raw = fs.readFileSync(this.stateFile, 'utf8');
    let state;
    try {
      state = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse sprint-state.json: ${err.message}`);
    }

    // Check if migration needed
    if (!state._schema_version) {
      // Create backup before first migration
      if (!fs.existsSync(this.backupFile)) {
        fs.copyFileSync(this.stateFile, this.backupFile);
      }
      state = migrateState(state, this.stateDir);
      // Write migrated state atomically
      this.write(state);
    }

    return state;
  }

  write(state) {
    // Ensure state directory exists
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    // Atomic write: write to tmp, then rename
    const tmpFile = this.stateFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpFile, this.stateFile);
  }

  transitionPhase(phase, status, options = {}) {
    const state = this.read() || createInitialState(this.projectRoot);

    // Update current phase
    state.phase = phase;

    // Find or create phase_history entry
    const phaseNames = ['PREP', 'DESIGN', 'BUILD', 'VERIFY', 'SHIP', 'CLOSE'];
    const phaseName = phaseNames[phase - 1];

    let entry = state.phase_history.find(e => e.phase === phase);
    if (!entry) {
      entry = {
        phase,
        phase_name: phaseName,
        status,
      };
      state.phase_history.push(entry);
    }

    // Update entry
    entry.status = status;
    if (status === 'in_progress' && !entry.started_at) {
      entry.started_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'skipped') {
      entry.completed_at = new Date().toISOString();
      if (entry.started_at) {
        const startMs = new Date(entry.started_at).getTime();
        const endMs = new Date(entry.completed_at).getTime();
        entry.duration_seconds = Math.round((endMs - startMs) / 1000);
      }
    }

    // Update outputs if provided
    if (options.outputs) {
      state.outputs = { ...state.outputs, ...options.outputs };
    }

    // Write state atomically
    this.write(state);

    // Trigger onTransition callback (for auto-render)
    if (typeof options.onTransition === 'function') {
      try {
        options.onTransition(state);
      } catch (err) {
        // Render failure is WARNING, not BLOCK
        console.warn(`[WARN] onTransition callback failed: ${err.message}`);
      }
    }

    return state;
  }

  rollback() {
    return rollbackState(this.stateFile, this.backupFile);
  }
}

module.exports = { SprintStateManager, LEGACY_PHASE_MAP };
