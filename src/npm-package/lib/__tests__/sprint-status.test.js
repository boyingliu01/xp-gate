/**
 * @test REQ-SPRINTSTATUS-001 Sprint Status CLI
 * @intent Validate xp-gate sprint-status command reads sprint-state.json and renders table
 * @covers AC-SPRINTSTATUS-001-01 through AC-SPRINTSTATUS-001-09
 */
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import the module
const sprintStatus = require('../sprint-status');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-status-test-'));
const STATE_DIR = path.join(TMP_DIR, '.sprint-state');
const STATE_FILE = path.join(STATE_DIR, 'sprint-state.json');

// Active sprint state (canonical format per SKILL.md L893-942)
const ACTIVE_STATE = {
  id: 'sprint-2026-06-16-01',
  task_description: 'Test sprint',
  phase: 2,
  status: 'running',
  started_at: '2026-06-16T10:00:00Z',
  isolation: {
    worktree_path: '.worktrees/sprint/sprint-2026-06-16-01',
    branch: 'sprint/2026-06-16-01',
    created_from: 'main',
    created_from_commit: 'abc123'
  },
  auto_estimate: {
    change_type: '新增功能',
    estimated_level: '轻量',
    user_decision: 'accepted'
  },
  phase_history: [
    { phase: -1, phase_name: 'ISOLATE', status: 'completed',
      started_at: '2026-06-16T10:00:00Z', completed_at: '2026-06-16T10:03:00Z', duration_seconds: 180 },
    { phase: -0.5, phase_name: 'AUTO-ESTIMATE', status: 'completed',
      started_at: '2026-06-16T10:03:00Z', completed_at: '2026-06-16T10:05:00Z', duration_seconds: 120 },
    { phase: 0, phase_name: 'THINK', status: 'completed',
      started_at: '2026-06-16T10:05:00Z', completed_at: '2026-06-16T10:15:00Z', duration_seconds: 600 },
    { phase: 1, phase_name: 'PLAN', status: 'completed',
      started_at: '2026-06-16T10:15:00Z', completed_at: '2026-06-16T10:25:00Z', duration_seconds: 600 },
    { phase: 2, phase_name: 'BUILD', status: 'in_progress',
      started_at: '2026-06-16T10:25:00Z', completed_at: null, duration_seconds: null,
      reqs: {
        'REQ-001': { name: 'Feature A', status: 'completed' },
        'REQ-002': { name: 'Feature B', status: 'in_progress' }
      }
    }
  ],
  outputs: { specification: '.sprint-state/phase-outputs/specification.yaml' },
  metrics: { tests_passed: 5, tests_failed: 0, coverage_pct: 85 }
};

const EMPTY_STATE = {};

const MINIMAL_STATE = {
  id: 'sprint-minimal',
  task_description: 'Minimal sprint',
  phase: 0,
  status: 'running',
  started_at: '2026-06-16T10:00:00Z',
  phase_history: []
};

beforeAll(() => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function deleteState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

describe('sprint-status: readSprintState', () => {
  // AC-SPRINTSTATUS-001-01: Reads state correctly
  test('reads active sprint-state.json', () => {
    writeState(ACTIVE_STATE);
    const state = sprintStatus.readSprintState(TMP_DIR);
    expect(state).not.toBeNull();
    expect(state.task_description).toBe('Test sprint');
    expect(state.phase).toBe(2);
    expect(state.status).toBe('running');
    expect(Array.isArray(state.phase_history)).toBe(true);
    expect(state.phase_history.length).toBeGreaterThan(0);
  });

  // AC-SPRINTSTATUS-001-02: No active sprint
  test('returns null when no sprint-state.json exists', () => {
    deleteState();
    const state = sprintStatus.readSprintState(TMP_DIR);
    expect(state).toBeNull();
  });

  // AC-SPRINTSTATUS-001-05: Malformed JSON with graceful defaults
  test('handles malformed sprint-state.json gracefully', () => {
    fs.writeFileSync(STATE_FILE, '{not valid json!!!');
    const state = sprintStatus.readSprintState(TMP_DIR);
    expect(state).toBeNull();
  });

  // AC-SPRINTSTATUS-001-05: Missing fields use defaults
  test('handles empty/partial state with defaults', () => {
    writeState(EMPTY_STATE);
    const state = sprintStatus.readSprintState(TMP_DIR);
    // Should return the empty object without crashing
    expect(state).toBeDefined();
  });

  // AC-SPRINTSTATUS-001-08: --dir parameter works
  test('reads state from custom directory', () => {
    writeState(ACTIVE_STATE);
    const state = sprintStatus.readSprintState(TMP_DIR);
    expect(state).not.toBeNull();
    expect(state.task_description).toBe('Test sprint');
  });
});

describe('sprint-status: formatSprintTable', () => {
  beforeEach(() => writeState(ACTIVE_STATE));

  // AC-SPRINTSTATUS-001-01: Table contains sprint info
  test('renders table with task_description and branch', () => {
    const output = sprintStatus.formatSprintTable(ACTIVE_STATE);
    expect(output).toContain('Test sprint');
    expect(output).toContain('sprint/2026-06-16-01');
  });

  // AC-SPRINTSTATUS-001-03: Completed phases have ✅
  test('marks completed phases with ✅', () => {
    const output = sprintStatus.formatSprintTable(ACTIVE_STATE);
    expect(output).toContain('✅');
  });

  // AC-SPRINTSTATUS-001-03: In-progress phases have 🔄
  test('marks in-progress phases with 🔄', () => {
    const output = sprintStatus.formatSprintTable(ACTIVE_STATE);
    expect(output).toContain('🔄');
  });

  // AC-SPRINTSTATUS-001-04: Missing phases show ⏳ Pending
  test('shows pending for phases not in phase_history', () => {
    const output = sprintStatus.formatSprintTable(ACTIVE_STATE);
    // Phase 3-8 are missing from phase_history
    expect(output).toContain('⏳');
    expect(output).toContain('Pending');
  });

  // AC-SPRINTSTATUS-001-05: Missing fields don't crash
  test('handles minimal state without crashing', () => {
    const output = sprintStatus.formatSprintTable(MINIMAL_STATE);
    expect(output).toBeDefined();
    expect(typeof output).toBe('string');
  });

  // AC-SPRINTSTATUS-001-06: JSON mode
  test('jsonMode returns raw state as JSON string', () => {
    const json = sprintStatus.jsonMode(ACTIVE_STATE);
    const parsed = JSON.parse(json);
    expect(parsed.task_description).toBe('Test sprint');
    expect(parsed.phase).toBe(2);
  });

  // AC-SPRINTSTATUS-001-09: Stale state detection
  test('detects stale state (>1h old)', () => {
    const staleState = JSON.parse(JSON.stringify(ACTIVE_STATE));
    staleState.started_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    const output = sprintStatus.formatSprintTable(staleState);
    expect(output).toContain('stale');
  });

  // REQ-level progress in BUILD phase
  test('shows REQ-level progress in BUILD phase', () => {
    const output = sprintStatus.formatSprintTable(ACTIVE_STATE);
    expect(output).toContain('REQ-001');
    expect(output).toContain('Feature A');
    expect(output).toContain('REQ-002');
    expect(output).toContain('Feature B');
  });
});
