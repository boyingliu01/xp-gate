/**
 * Tests for Sprint State Manager
 * @test REQ-001 Sprint State Manager
 * @intent Verify read/write/migration/transitionPhase/rollback
 * @covers AC-001-01, AC-001-02, AC-001-03
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SprintStateManager, LEGACY_PHASE_MAP } from '../sprint-state-manager.js';
import { migrateState, createInitialState } from '../sprint-state-migrator.js';

describe('SprintStateManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-state-test-'));
    manager = new SprintStateManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('returns null when file does not exist', () => {
      const state = manager.read();
      expect(state).toBeNull();
    });

    it('reads valid state file', () => {
      const state = {
        _schema_version: 1,
        id: 'sprint-123',
        task_description: 'Test sprint',
        phase: 2,
        status: 'in_progress',
        started_at: '2026-07-14T10:00:00Z',
        phase_history: [],
        isolation: { worktree_path: tmpDir, branch: 'test' },
      };
      fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
        JSON.stringify(state, null, 2)
      );

      const result = manager.read();
      expect(result.id).toBe('sprint-123');
      expect(result._schema_version).toBe(1);
    });

    it('auto-migrates legacy state and creates backup', () => {
      const legacyState = {
        id: 'sprint-legacy',
        task_description: 'Legacy sprint',
        phase: -1, // Legacy ISOLATE → 1 (PREP)
        status: 'completed',
        phase_history: [
          { phase: -1, phase_name: 'ISOLATE', status: 'completed', timestamp: '2026-07-14T10:00:00Z' },
        ],
        isolation: { worktree_path: tmpDir, branch: 'test' },
      };
      fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
        JSON.stringify(legacyState, null, 2)
      );

      const result = manager.read();

      // Should be migrated
      expect(result._schema_version).toBe(1);
      expect(result.phase).toBe(1); // -1 → 1
      expect(result.phase_history[0].phase).toBe(1);
      expect(result.phase_history[0].phase_name).toBe('PREP');
      expect(result.phase_history[0].started_at).toBe('2026-07-14T10:00:00Z'); // timestamp → started_at

      // Backup should exist
      const backupExists = fs.existsSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json.backup'));
      expect(backupExists).toBe(true);
    });
  });

  describe('write()', () => {
    it('writes state atomically', () => {
      const state = {
        _schema_version: 1,
        id: 'sprint-test',
        task_description: 'Test',
        phase: 1,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        phase_history: [],
        isolation: { worktree_path: tmpDir, branch: 'test' },
      };

      manager.write(state);

      const written = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json'), 'utf8')
      );
      expect(written.id).toBe('sprint-test');

      // Tmp file should not exist (atomic write completed)
      const tmpExists = fs.existsSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json.tmp'));
      expect(tmpExists).toBe(false);
    });
  });

  describe('transitionPhase()', () => {
    it('creates new phase_history entry', () => {
      // Create initial state
      const initialState = createInitialState(tmpDir);
      manager.write(initialState);

      // Transition to phase 2
      const result = manager.transitionPhase(2, 'in_progress');

      expect(result.phase).toBe(2);
      expect(result.phase_history.length).toBe(1);
      expect(result.phase_history[0].phase).toBe(2);
      expect(result.phase_history[0].phase_name).toBe('DESIGN');
      expect(result.phase_history[0].status).toBe('in_progress');
      expect(result.phase_history[0].started_at).toBeDefined();
    });

    it('updates existing phase_history entry', () => {
      const initialState = createInitialState(tmpDir);
      manager.write(initialState);

      // Start phase 2
      manager.transitionPhase(2, 'in_progress');

      // Complete phase 2
      const result = manager.transitionPhase(2, 'completed');

      expect(result.phase_history[0].status).toBe('completed');
      expect(result.phase_history[0].completed_at).toBeDefined();
      expect(result.phase_history[0].duration_seconds).toBeGreaterThanOrEqual(0);
    });

    it('calls onTransition callback', () => {
      const initialState = createInitialState(tmpDir);
      manager.write(initialState);

      let callbackCalled = false;
      let callbackState = null;

      manager.transitionPhase(2, 'in_progress', {
        onTransition: (state) => {
          callbackCalled = true;
          callbackState = state;
        },
      });

      expect(callbackCalled).toBe(true);
      expect(callbackState.phase).toBe(2);
    });

    it('handles onTransition callback errors gracefully', () => {
      const initialState = createInitialState(tmpDir);
      manager.write(initialState);

      // Should not throw
      expect(() => {
        manager.transitionPhase(2, 'in_progress', {
          onTransition: () => {
            throw new Error('Render failed');
          },
        });
      }).not.toThrow();

      // State should still be updated
      const state = manager.read();
      expect(state.phase).toBe(2);
    });

    it('updates outputs when provided', () => {
      const initialState = createInitialState(tmpDir);
      manager.write(initialState);

      const result = manager.transitionPhase(2, 'completed', {
        outputs: { specification: 'spec.yaml' },
      });

      expect(result.outputs.specification).toBe('spec.yaml');
    });
  });

  describe('migrate()', () => {
    it('adds _schema_version', () => {
      const state = { id: 'test', phase: 1, phase_history: [] };
      const migrated = migrateState(state, manager.stateDir);
      expect(migrated._schema_version).toBe(1);
    });

    it('sets default task_description if missing', () => {
      const state = { id: 'test', phase: 1, phase_history: [] };
      const migrated = migrateState(state, manager.stateDir);
      expect(migrated.task_description).toBe('-');
    });

    it('migrates all legacy phase numbers', () => {
      for (const [legacy, expected] of Object.entries(LEGACY_PHASE_MAP)) {
        const state = {
          id: 'test',
          phase: Number(legacy),
          phase_history: [{ phase: Number(legacy), status: 'completed' }],
        };
        const migrated = migrateState(state, manager.stateDir);
        expect(migrated.phase).toBe(expected.phase);
        expect(migrated.phase_history[0].phase).toBe(expected.phase);
        expect(migrated.phase_history[0].phase_name).toBe(expected.phase_name);
      }
    });

    it('preserves unknown fields', () => {
      const state = {
        id: 'test',
        phase: 1,
        phase_history: [],
        custom_field: 'preserved',
      };
      const migrated = migrateState(state, manager.stateDir);
      expect(migrated.custom_field).toBe('preserved');
    });
  });

  describe('rollback()', () => {
    it('returns false when no backup exists', () => {
      const result = manager.rollback();
      expect(result).toBe(false);
    });

    it('restores from backup', () => {
      // Create initial state and backup
      const originalState = {
        _schema_version: 1,
        id: 'original',
        task_description: 'Original',
        phase: 1,
        status: 'in_progress',
        started_at: '2026-07-14T10:00:00Z',
        phase_history: [],
        isolation: { worktree_path: tmpDir, branch: 'test' },
      };
      fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
        JSON.stringify(originalState, null, 2)
      );
      fs.writeFileSync(
        path.join(tmpDir, '.sprint-state', 'sprint-state.json.backup'),
        JSON.stringify(originalState, null, 2)
      );

      // Modify current state
      const modifiedState = { ...originalState, id: 'modified' };
      fs.writeFileSync(
        path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
        JSON.stringify(modifiedState, null, 2)
      );

      // Rollback
      const result = manager.rollback();
      expect(result).toBe(true);

      // Verify restored
      const restored = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json'), 'utf8')
      );
      expect(restored.id).toBe('original');
    });
  });
});
