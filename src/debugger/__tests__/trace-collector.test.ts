import { describe, it, expect } from 'vitest';
import { parseTrace, extractToolCalls, trackComponentMetrics } from '../trace-collector';
import type { ComponentName } from '../types';

const VALID_JSONL = [
  JSON.stringify({ status: 'completed', phase: 2 }),
  JSON.stringify({ skill_name: 'test-driven-development', phase: 2, timestamp: 1000, success: true }),
  JSON.stringify({ skill_name: 'delphi-review', phase: 3, timestamp: 2000, success: false }),
  JSON.stringify({ decision_point: true, phase: 1, pause_reason: 'wait_approved', resolved: true }),
  JSON.stringify({ tokens_used: 5000 }),
];

describe('parseTrace', () => {
  it('parses status and phase range from JSONL', () => {
    const trace = parseTrace(VALID_JSONL);
    expect(trace.status).toBe('completed');
    expect(trace.phase_entrance).toBe(2);
    expect(trace.phase_exit).toBe(3);
  });

  it('extracts tool calls', () => {
    const trace = parseTrace(VALID_JSONL);
    expect(trace.tool_calls).toHaveLength(2);
    expect(trace.tool_calls[0].skill_name).toBe('test-driven-development');
    expect(trace.tool_calls[1].success).toBe(false);
  });

  it('extracts decision points', () => {
    const trace = parseTrace(VALID_JSONL);
    expect(trace.decision_points).toHaveLength(1);
    expect(trace.decision_points[0].pause_reason).toBe('wait_approved');
    expect(trace.decision_points[0].resolved).toBe(true);
  });

  it('aggregates token usage', () => {
    const trace = parseTrace(VALID_JSONL);
    expect(trace.total_tokens).toBe(5000);
  });

  it('handles empty input', () => {
    const trace = parseTrace([]);
    expect(trace.status).toBe('completed');
    expect(trace.phase_entrance).toBe(0);
    expect(trace.phase_exit).toBe(0);
    expect(trace.tool_calls).toHaveLength(0);
  });

  it('handles non-JSON lines gracefully', () => {
    const jsonl = ['not json', VALID_JSONL[0], '--- divider ---'];
    const trace = parseTrace(jsonl);
    expect(trace.status).toBe('completed');
  });
});

describe('extractToolCalls', () => {
  it('returns only entries with skill_name and phase', () => {
    const calls = extractToolCalls(VALID_JSONL);
    expect(calls).toHaveLength(2);
  });
});

describe('trackComponentMetrics', () => {
  it('counts component changes', () => {
    const history: { component_changes: ComponentName[]; date: string }[] = [
      { component_changes: ['middleware', 'tools'], date: '2026-05-22' },
      { component_changes: ['middleware'], date: '2026-05-23' },
    ];
    const metrics = trackComponentMetrics(history);
    const middleware = metrics.find((m) => m.component === 'middleware');
    expect(middleware?.change_count).toBe(2);
    const tools = metrics.find((m) => m.component === 'tools');
    expect(tools?.change_count).toBe(1);
  });

  it('tracks latest modification date', () => {
    const history: { component_changes: ComponentName[]; date: string }[] = [
      { component_changes: ['memory'], date: '2026-05-20' },
      { component_changes: ['memory'], date: '2026-05-25' },
    ];
    const metrics = trackComponentMetrics(history);
    const memory = metrics.find((m) => m.component === 'memory');
    expect(memory?.last_modified).toBe('2026-05-25');
  });
});
