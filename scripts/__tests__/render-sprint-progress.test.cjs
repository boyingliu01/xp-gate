// vitest globals: true — no import needed
const { renderDashboard, formatDuration, formatTimestamp, getPhaseStatus, normalizePhaseNum, isLegacyState, PHASES } = require('../render-sprint-progress.cjs');

// ── formatDuration ──────────────────────────────────────────────────────
describe('formatDuration', () => {
  it('returns "-" for null/undefined', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
  });

  it('returns "-" for negative values', () => {
    expect(formatDuration(-1)).toBe('-');
  });

  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(3599)).toBe('59m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(86399)).toBe('23h 59m');
  });

  it('formats days and hours', () => {
    expect(formatDuration(86400)).toBe('1d 0h');
    expect(formatDuration(172800)).toBe('2d 0h');
    expect(formatDuration(180000)).toBe('2d 2h');
  });
});

// ── formatTimestamp ─────────────────────────────────────────────────────
describe('formatTimestamp', () => {
  it('returns "-" for null/empty', () => {
    expect(formatTimestamp(null)).toBe('-');
    expect(formatTimestamp('')).toBe('-');
  });

  it('returns "-" for invalid date', () => {
    expect(formatTimestamp('not-a-date')).toBe('-');
  });

  it('formats valid ISO timestamp', () => {
    const result = formatTimestamp('2026-06-04T18:30:00Z');
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });
});

// ── normalizePhaseNum ───────────────────────────────────────────────────
describe('normalizePhaseNum', () => {
  it('maps unambiguous legacy numbers', () => {
    expect(normalizePhaseNum(-1)).toBe(1);      // ISOLATE → PREP
    expect(normalizePhaseNum(-0.5)).toBe(1);    // AUTO-ESTIMATE → PREP
    expect(normalizePhaseNum(0)).toBe(2);       // THINK → DESIGN
    expect(normalizePhaseNum(7)).toBe(6);       // USER ACCEPTANCE → CLOSE
    expect(normalizePhaseNum(8)).toBe(6);       // CLEANUP → CLOSE
  });

  it('does NOT map ambiguous 1-6 by default (new model)', () => {
    expect(normalizePhaseNum(1)).toBe(1);
    expect(normalizePhaseNum(2)).toBe(2);
    expect(normalizePhaseNum(3)).toBe(3);
    expect(normalizePhaseNum(4)).toBe(4);
    expect(normalizePhaseNum(5)).toBe(5);
    expect(normalizePhaseNum(6)).toBe(6);
  });

  it('maps ambiguous 1-6 when isLegacy=true', () => {
    expect(normalizePhaseNum(1, true)).toBe(2);  // PLAN → DESIGN
    expect(normalizePhaseNum(2, true)).toBe(3);  // BUILD → BUILD
    expect(normalizePhaseNum(3, true)).toBe(4);  // REVIEW → VERIFY
    expect(normalizePhaseNum(4, true)).toBe(4);  // FEEDBACK → VERIFY
    expect(normalizePhaseNum(5, true)).toBe(5);  // SHIP → SHIP
    expect(normalizePhaseNum(6, true)).toBe(5);  // LAND → SHIP
  });
});

// ── isLegacyState ───────────────────────────────────────────────────────
describe('isLegacyState', () => {
  it('returns true for states with legacy phase numbers', () => {
    expect(isLegacyState({ phase: -1 })).toBe(true);
    expect(isLegacyState({ phase: -0.5 })).toBe(true);
    expect(isLegacyState({ phase: 0 })).toBe(true);
    expect(isLegacyState({ phase: 7 })).toBe(true);
    expect(isLegacyState({ phase: 8 })).toBe(true);
  });

  it('returns true for states with legacy phase_history entries', () => {
    expect(isLegacyState({ phase: 3, phase_history: [{ phase: -1 }] })).toBe(true);
    expect(isLegacyState({ phase: 3, phase_history: [{ phase: 0, phase_name: 'THINK' }] })).toBe(true);
  });

  it('returns false for new model states', () => {
    expect(isLegacyState({ phase: 3, phase_model: 'compact' })).toBe(false);
    expect(isLegacyState({ phase: 3, schema_version: 2 })).toBe(false);
    expect(isLegacyState({ phase: 1, phase_history: [{ phase: 1, phase_name: 'PREP' }] })).toBe(false);
  });
});

// ── getPhaseStatus ───────────────────────────────────────────────────────
describe('getPhaseStatus', () => {
  it('returns status from phase_history (new model)', () => {
    const history = [
      { phase: 1, phase_name: 'PREP', status: 'completed' },
      { phase: 3, phase_name: 'BUILD', status: 'running' },
    ];
    expect(getPhaseStatus(history, 1, 3, false)).toBe('completed');
    expect(getPhaseStatus(history, 3, 3, false)).toBe('running');
  });

  it('returns status from phase_history (legacy model)', () => {
    const history = [
      { phase: -1, phase_name: 'ISOLATE', status: 'completed' },
      { phase: 2, phase_name: 'BUILD', status: 'running' },
    ];
    // Legacy: -1→1 (PREP), 2→3 (BUILD)
    expect(getPhaseStatus(history, 1, 3, true)).toBe('completed');
    expect(getPhaseStatus(history, 3, 3, true)).toBe('running');
  });

  it('returns "pending" for phase not in history', () => {
    const history = [{ phase: 1, phase_name: 'PREP', status: 'completed' }];
    expect(getPhaseStatus(history, 6, 3, false)).toBe('pending');
  });

  it('infers status from currentPhase (no history)', () => {
    expect(getPhaseStatus(null, 1, 3, false)).toBe('completed');
    expect(getPhaseStatus(null, 3, 3, false)).toBe('running');
    expect(getPhaseStatus(null, 5, 3, false)).toBe('pending');
  });
});

// ── PHASES ──────────────────────────────────────────────────────────────
describe('PHASES', () => {
  it('has 6 phases', () => {
    expect(PHASES).toHaveLength(6);
  });

  it('starts with PREP and ends with CLOSE', () => {
    expect(PHASES[0].name).toBe('PREP');
    expect(PHASES[5].name).toBe('CLOSE');
  });

  it('has correct phase numbers 1-6', () => {
    expect(PHASES.map(p => p.num)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('has correct phase names', () => {
    expect(PHASES.map(p => p.name)).toEqual(['PREP', 'DESIGN', 'BUILD', 'VERIFY', 'SHIP', 'CLOSE']);
  });
});

// ── renderDashboard ─────────────────────────────────────────────────────
describe('renderDashboard', () => {
  it('renders basic dashboard with minimal state', () => {
    const state = {
      id: 'test-sprint',
      phase_model: 'compact',
      phase: 1,
      status: 'running',
    };
    const output = renderDashboard(state);
    expect(output).toContain('SPRINT PROGRESS');
    expect(output).toContain('test-sprint');
    expect(output).toContain('Phase 1/6');
    expect(output).toContain('PREP');
  });

  it('shows task_description or "-" when missing', () => {
    const withDesc = renderDashboard({ id: 's1', phase_model: 'compact', task_description: 'Do stuff', phase: 2, status: 'running' });
    expect(withDesc).toContain('Do stuff');

    const without = renderDashboard({ id: 's2', phase_model: 'compact', phase: 2, status: 'running' });
    expect(without).toContain('-');
  });

  it('shows branch from isolation', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 2,
      status: 'running',
      isolation: { branch: 'sprint/test-branch' },
    };
    const output = renderDashboard(state);
    expect(output).toContain('sprint/test-branch');
  });

  it('renders phase icons based on status', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      phase_history: [
        { phase: 1, phase_name: 'PREP', status: 'completed', duration_seconds: 120 },
        { phase: 3, phase_name: 'BUILD', status: 'running', duration_seconds: 600 },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u2705'); // completed checkmark
    expect(output).toContain('\uD83D\uDD04'); // running arrows
    expect(output).toContain('\u2B1C'); // pending square
  });

  it('renders progress bar with correct percentage (new model)', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      phase_history: [
        { phase: 1, phase_name: 'PREP', status: 'completed' },
        { phase: 2, phase_name: 'DESIGN', status: 'completed' },
        { phase: 3, phase_name: 'BUILD', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    // 2 completed out of 6 = 33%
    expect(output).toContain('33%');
  });

  it('renders progress bar with correct percentage (legacy model)', () => {
    const state = {
      id: 's1',
      phase: 2, // legacy BUILD
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed' },
        { phase: -0.5, phase_name: 'AUTO-ESTIMATE', status: 'completed' },
        { phase: 0, phase_name: 'THINK', status: 'completed' },
        { phase: 1, phase_name: 'PLAN', status: 'completed' },
        { phase: 2, phase_name: 'BUILD', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    // Legacy: -1→1(PREP), -0.5→1(PREP), 0→2(DESIGN), 1→2(DESIGN), 2→3(BUILD)
    // PREP completed, DESIGN completed, BUILD running → 2/6 = 33%
    expect(output).toContain('33%');
  });

  it('shows output list when outputs exist', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      outputs: {
        specification: '.sprint-state/phase-outputs/specification.yaml',
      },
    };
    const output = renderDashboard(state);
    expect(output).toContain('specification');
    expect(output).toContain('specification.yaml');
  });

  it('shows "(无)" when no outputs', () => {
    const state = { id: 's1', phase_model: 'compact', phase: 2, status: 'running', outputs: {} };
    const output = renderDashboard(state);
    expect(output).toContain('(\u65E0)');
  });

  it('shows next action for known phase+status', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      phase_history: [
        { phase: 1, phase_name: 'PREP', status: 'completed' },
        { phase: 2, phase_name: 'DESIGN', status: 'completed' },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u4E0B\u4E00\u6B65'); // "下一步"
  });

  it('shows "处理错误" for failed status', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      phase_history: [
        { phase: 3, phase_name: 'BUILD', status: 'failed' },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u5904\u7406\u9519\u8BEF');
  });

  it('handles completed sprint (new model)', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 6,
      status: 'completed',
      phase_history: PHASES.map((p) => ({
        phase: p.num,
        phase_name: p.name,
        status: 'completed',
        duration_seconds: 60,
      })),
    };
    const output = renderDashboard(state);
    expect(output).toContain('100%');
  });

  it('renders skipped phases with skip icon', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 3,
      status: 'running',
      phase_history: [
        { phase: 1, phase_name: 'PREP', status: 'completed' },
        { phase: 2, phase_name: 'DESIGN', status: 'skipped' },
        { phase: 3, phase_name: 'BUILD', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u23ED'); // skipped icon
  });

  it('handles missing isolation gracefully', () => {
    const state = { id: 's1', phase_model: 'compact', phase: 2, status: 'running' };
    const output = renderDashboard(state);
    expect(output).toContain('-'); // branch shows "-"
  });

  it('formats started_at timestamp', () => {
    const state = {
      id: 's1',
      phase_model: 'compact',
      phase: 2,
      status: 'running',
      started_at: '2026-06-04T18:30:00Z',
    };
    const output = renderDashboard(state);
    expect(output).toMatch(/2026-06-0[45]/);
  });

  it('renders legacy state correctly (backward compat)', () => {
    const state = {
      id: 'legacy-sprint',
      phase: 5, // legacy SHIP
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed' },
        { phase: -0.5, phase_name: 'AUTO-ESTIMATE', status: 'completed' },
        { phase: 0, phase_name: 'THINK', status: 'completed' },
        { phase: 1, phase_name: 'PLAN', status: 'completed' },
        { phase: 2, phase_name: 'BUILD', status: 'completed' },
        { phase: 3, phase_name: 'REVIEW', status: 'completed' },
        { phase: 4, phase_name: 'FEEDBACK', status: 'completed' },
        { phase: 5, phase_name: 'SHIP', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    // Should render 6-phase dashboard with correct mapping
    expect(output).toContain('Phase 1/6');
    expect(output).toContain('PREP');
    expect(output).toContain('Phase 5/6');
    expect(output).toContain('SHIP');
    // Phases 1-4 should be completed (PREP, DESIGN, BUILD, VERIFY)
    // Phase 5 (SHIP) should be running
    // 4/6 = 67%
    expect(output).toContain('67%');
  });
});
