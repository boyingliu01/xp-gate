// vitest globals: true — no import needed
const { renderDashboard, formatDuration, formatTimestamp, getPhaseStatus, PHASES } = require('../render-sprint-progress.cjs');

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

// ── getPhaseStatus ───────────────────────────────────────────────────────
describe('getPhaseStatus', () => {
  it('returns status from phase_history when available', () => {
    const history = [
      { phase: -1, status: 'completed' },
      { phase: 2, status: 'running' },
    ];
    expect(getPhaseStatus(history, -1, 2)).toBe('completed');
    expect(getPhaseStatus(history, 2, 2)).toBe('running');
  });

  it('returns "pending" for phase not in history', () => {
    const history = [{ phase: -1, status: 'completed' }];
    expect(getPhaseStatus(history, 3, 2)).toBe('pending');
  });

  it('infers status from currentPhase (backward compat)', () => {
    expect(getPhaseStatus(null, -1, 2)).toBe('completed');
    expect(getPhaseStatus(null, 0, 2)).toBe('completed');
    expect(getPhaseStatus(null, 2, 2)).toBe('running');
    expect(getPhaseStatus(null, 3, 2)).toBe('pending');
  });
});

// ── PHASES ──────────────────────────────────────────────────────────────
describe('PHASES', () => {
  it('has 11 phases', () => {
    expect(PHASES).toHaveLength(11);
  });

  it('starts with ISOLATE and ends with CLEANUP', () => {
    expect(PHASES[0].name).toBe('ISOLATE');
    expect(PHASES[10].name).toBe('CLEANUP');
  });
});

// ── renderDashboard ─────────────────────────────────────────────────────
describe('renderDashboard', () => {
  it('renders basic dashboard with minimal state', () => {
    const state = {
      id: 'test-sprint',
      phase: -1,
      status: 'running',
    };
    const output = renderDashboard(state);
    expect(output).toContain('SPRINT PROGRESS');
    expect(output).toContain('test-sprint');
    expect(output).toContain('Phase -1');
    expect(output).toContain('ISOLATE');
  });

  it('shows task_description or "-" when missing', () => {
    const withDesc = renderDashboard({ id: 's1', task_description: 'Do stuff', phase: 0, status: 'running' });
    expect(withDesc).toContain('Do stuff');

    const without = renderDashboard({ id: 's2', phase: 0, status: 'running' });
    expect(without).toContain('-');
  });

  it('shows branch from isolation', () => {
    const state = {
      id: 's1',
      phase: 0,
      status: 'running',
      isolation: { branch: 'sprint/test-branch' },
    };
    const output = renderDashboard(state);
    expect(output).toContain('sprint/test-branch');
  });

  it('renders phase icons based on status', () => {
    const state = {
      id: 's1',
      phase: 2,
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed', duration_seconds: 120 },
        { phase: 2, phase_name: 'BUILD', status: 'running', duration_seconds: 600 },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u2705'); // completed checkmark
    expect(output).toContain('\uD83D\uDD04'); // running arrows
    expect(output).toContain('\u2B1C'); // pending square
  });

  it('renders progress bar with correct percentage', () => {
    const state = {
      id: 's1',
      phase: 2,
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed' },
        { phase: -0.5, phase_name: 'AUTO-ESTIMATE', status: 'completed' },
        { phase: 2, phase_name: 'BUILD', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    // -1, -0.5 completed (from history) + 0, 1 completed (inferred, < currentPhase) = 4/11 = 36%
    expect(output).toContain('36%');
  });

  it('shows output list when outputs exist', () => {
    const state = {
      id: 's1',
      phase: 2,
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
    const state = { id: 's1', phase: 0, status: 'running', outputs: {} };
    const output = renderDashboard(state);
    expect(output).toContain('(\u65E0)');
  });

  it('shows next action for known phase+status', () => {
    const state = {
      id: 's1',
      phase: -1,
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed', duration_seconds: 180 },
      ],
    };
    // Override phase to match completed status
    state.phase = 0;
    const output = renderDashboard(state);
    // Phase -1 completed → "确认环境"
    // But current phase is 0, so currentStatus is "running" (not in history)
    expect(output).toContain('\u4E0B\u4E00\u6B65');
  });

  it('shows "处理错误" for failed status', () => {
    const state = {
      id: 's1',
      phase: 2,
      status: 'running',
      phase_history: [
        { phase: 2, phase_name: 'BUILD', status: 'failed' },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u5904\u7406\u9519\u8BEF');
  });

  it('handles completed sprint', () => {
    const state = {
      id: 's1',
      phase: 8,
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
    expect(output).toContain('Sprint \u5B8C\u6210');
  });

  it('renders skipped phases with skip icon', () => {
    const state = {
      id: 's1',
      phase: 1,
      status: 'running',
      phase_history: [
        { phase: -1, phase_name: 'ISOLATE', status: 'completed' },
        { phase: 0, phase_name: 'THINK', status: 'skipped' },
        { phase: 1, phase_name: 'PLAN', status: 'running' },
      ],
    };
    const output = renderDashboard(state);
    expect(output).toContain('\u23ED'); // skipped icon
  });

  it('handles missing isolation gracefully', () => {
    const state = { id: 's1', phase: 0, status: 'running' };
    const output = renderDashboard(state);
    expect(output).toContain('-'); // branch shows "-"
  });

  it('formats started_at timestamp', () => {
    const state = {
      id: 's1',
      phase: 0,
      status: 'running',
      started_at: '2026-06-04T18:30:00Z',
    };
    const output = renderDashboard(state);
    expect(output).toMatch(/2026-06-0[45]/);
  });
});
