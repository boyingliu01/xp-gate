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

/** Canonical phase order; index = phase - 1. */
const PHASE_NAMES = ['PREP', 'DESIGN', 'BUILD', 'VERIFY', 'SHIP', 'CLOSE'];

/**
 * Apply a status change to the phase_history entry for `phase`, creating it on
 * first sight, and stamp started_at/completed_at/duration_seconds.
 *
 * Module-level and pure (it only mutates the passed-in state), extracted from
 * transitionPhase (#519) so that method stays within the long-function budget.
 */
function applyHistoryEntry(state, phase, phaseName, status) {
  let entry = state.phase_history.find(e => e.phase === phase);
  if (!entry) {
    entry = { phase, phase_name: phaseName, status };
    state.phase_history.push(entry);
  }

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
  return entry;
}

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
    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }
      // Atomic write: write to tmp, then rename
      const tmpFile = this.stateFile + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.stateFile);
    } catch (err) {
      throw new Error(`Failed to write sprint state: ${err.message}`);
    }
  }

  transitionPhase(phase, status, options = {}) {
    const state = this.read() || createInitialState(this.projectRoot);

    // Capture the before-image so the caller can echo a before/after
    // comparison. #519: the same values feed the append-only audit log.
    const beforePhase = state.phase;
    const beforeEntry = Array.isArray(state.phase_history)
      ? state.phase_history.find(e => e.phase === phase)
      : undefined;
    const beforeStatus = beforeEntry ? beforeEntry.status : undefined;

    state.phase = phase;
    const phaseName = PHASE_NAMES[phase - 1];
    applyHistoryEntry(state, phase, phaseName, status);

    if (options.outputs) {
      state.outputs = { ...state.outputs, ...options.outputs };
    }

    this.write(state);

    // #519: append-only transition audit. The #507 incident proved that a
    // MISSED transition is invisible in the state file — the pointer drift
    // looked identical to a legitimately-not-yet-run phase. A per-transition
    // record — from/to plus statuses — lets post-mortems distinguish "never
    // ran" from "ran and was overwritten". Best-effort: a logging failure must
    // never break the transition, same contract as the onTransition callback.
    this.appendTransitionAudit({
      phase,
      phase_name: phaseName,
      from_phase: beforePhase,
      // from_status === undefined together with a defined to_status is exactly
      // what proves the phase was reached from nothing — i.e. never ran.
      from_status: beforeStatus,
      to_status: status,
      timestamp: new Date().toISOString(),
    });

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

  /**
   * Append one JSON line to .sprint-state/transition-audit.jsonl (#519).
   * Never throws — audit is evidence, not a gate.
   * @param {object} record
   */
  appendTransitionAudit(record) {
    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }
      const auditFile = path.join(this.stateDir, 'transition-audit.jsonl');
      fs.appendFileSync(auditFile, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.warn(`[WARN] transition audit write failed: ${err.message}`);
    }
  }

  rollback() {
    return rollbackState(this.stateFile, this.backupFile);
  }
}

module.exports = { SprintStateManager, LEGACY_PHASE_MAP };
