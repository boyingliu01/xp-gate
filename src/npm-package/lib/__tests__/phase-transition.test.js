/**
 * Tests for phase-transition CLI command
 * @test REQ-338 Phase transition CLI + dashboard rendering
 * @intent Verify phase-transition command updates state and renders dashboard
 * @covers AC-338-01 (CLI transitions phase and writes state)
 * @covers AC-338-02 (--render flag outputs ASCII dashboard)
 * @covers AC-338-03 (invalid inputs return error exit code)
 * @covers AC-338-04 (--outputs flag records outputs in state)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePhaseTransition, renderDashboard } from '../phase-transition.js';

describe('phase-transition', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-transition-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('handlePhaseTransition()', () => {
    it('returns 0 and shows help with --help', async () => {
      const code = await handlePhaseTransition(['--help']);
      expect(code).toBe(0);
    });

    it('returns 1 for missing arguments', async () => {
      const code = await handlePhaseTransition([]);
      expect(code).toBe(1);
    });

    it('returns 1 for invalid phase number', async () => {
      const code = await handlePhaseTransition(['7', 'completed']);
      expect(code).toBe(1);
    });

    it('returns 1 for invalid status', async () => {
      const code = await handlePhaseTransition(['1', 'invalid_status']);
      expect(code).toBe(1);
    });

    it('transitions phase and writes state file', async () => {
      const code = await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      expect(code).toBe(0);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.phase).toBe(1);
      expect(state.phase_history).toHaveLength(1);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[0].phase_name).toBe('PREP');
    });

    it('records outputs when --outputs flag is provided', async () => {
      const outputs = JSON.stringify({ spec: 'path/to/spec.yaml' });
      const code = await handlePhaseTransition(['2', 'completed', '--outputs', outputs, '--dir', tmpDir]);
      expect(code).toBe(0);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.outputs.spec).toBe('path/to/spec.yaml');
    });

    it('returns 1 for invalid --outputs JSON', async () => {
      const code = await handlePhaseTransition(['1', 'completed', '--outputs', 'not-json', '--dir', tmpDir]);
      expect(code).toBe(1);
    });

    it('transitions through multiple phases sequentially', async () => {
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['2', 'in_progress', '--dir', tmpDir]);
      await handlePhaseTransition(['2', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['3', 'in_progress', '--dir', tmpDir]);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      expect(state.phase).toBe(3);
      expect(state.phase_history).toHaveLength(3);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[1].status).toBe('completed');
      expect(state.phase_history[2].status).toBe('in_progress');
    });

    it('updates existing entry when same phase is transitioned again', async () => {
      await handlePhaseTransition(['1', 'in_progress', '--dir', tmpDir]);
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      // Should NOT have duplicate entries
      expect(state.phase_history).toHaveLength(1);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[0].completed_at).toBeDefined();
    });
  });

  describe('renderDashboard()', () => {
    it('returns "No sprint state found" for null state', () => {
      const result = renderDashboard(null);
      expect(result).toBe('No sprint state found');
    });

    it('renders dashboard with all 6 phases', () => {
      const state = {
        id: 'sprint-test-123',
        task_description: 'Test feature',
        phase: 3,
        status: 'in_progress',
        started_at: '2026-07-21T10:00:00Z',
        phase_history: [
          { phase: 1, phase_name: 'PREP', status: 'completed', duration_seconds: 120 },
          { phase: 2, phase_name: 'DESIGN', status: 'completed', duration_seconds: 300 },
          { phase: 3, phase_name: 'BUILD', status: 'in_progress' },
        ],
        isolation: { branch: 'sprint/test-branch' },
        outputs: {},
      };

      const result = renderDashboard(state);

      expect(result).toContain('SPRINT PROGRESS');
      expect(result).toContain('sprint-test-123');
      expect(result).toContain('Test feature');
      expect(result).toContain('sprint/test-branch');
      expect(result).toContain('Phase 1/6');
      expect(result).toContain('Phase 6/6');
      expect(result).toContain('✅'); // completed phases
      expect(result).toContain('🔄'); // in_progress phase
      expect(result).toContain('⏳'); // pending phases
    });

    it('shows outputs section when outputs exist', () => {
      const state = {
        id: 'sprint-out',
        task_description: 'Feature',
        phase: 2,
        status: 'in_progress',
        started_at: '2026-07-21T10:00:00Z',
        phase_history: [],
        isolation: { branch: 'test' },
        outputs: { spec: 'design.yaml', pr: '#42' },
      };

      const result = renderDashboard(state);
      expect(result).toContain('输出物');
      expect(result).toContain('spec: design.yaml');
      expect(result).toContain('pr: #42');
    });

    it('handles minimal state gracefully', () => {
      const state = {
        id: 'sprint-min',
        phase: 1,
        status: 'in_progress',
        phase_history: [],
      };

      const result = renderDashboard(state);
      expect(result).toContain('SPRINT PROGRESS');
      expect(result).toContain('sprint-min');
    });
  });
});
