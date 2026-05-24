import { describe, it, expect } from 'vitest';
import { analyzeTrace, formatSummary } from '../summarizer';
import { SprintTrace } from '../types';

const SUCCESS_TRACE: SprintTrace = {
  sprint_id: 'sprint-001',
  phase_entrance: 0,
  phase_exit: 6,
  tool_calls: [
    { skill_name: 'brainstorming', phase: 0, timestamp_ms: 1000, success: true },
    { skill_name: 'delphi-review', phase: 1, timestamp_ms: 2000, success: true },
    { skill_name: 'test-driven-development', phase: 2, timestamp_ms: 3000, success: true },
  ],
  decision_points: [
    { phase: 0, pause_reason: 'wait_approved', resolved: true },
  ],
  total_tokens: 15000,
  status: 'completed',
};

const FAILURE_TRACE: SprintTrace = {
  sprint_id: 'sprint-002',
  phase_entrance: 0,
  phase_exit: 3,
  tool_calls: [
    { skill_name: 'brainstorming', phase: 0, timestamp_ms: 1000, success: true },
    { skill_name: 'test-driven-development', phase: 2, timestamp_ms: 2000, success: false },
    { skill_name: 'test-driven-development', phase: 2, timestamp_ms: 3000, success: false },
  ],
  decision_points: [],
  total_tokens: 8000,
  status: 'failed',
};

describe('analyzeTrace', () => {
  it('returns no summaries for successful trace', () => {
    const summaries = analyzeTrace(SUCCESS_TRACE);
    expect(summaries).toHaveLength(0);
  });

  it('generates summary for failed tool calls', () => {
    const summaries = analyzeTrace(FAILURE_TRACE);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].problem).toContain('test-driven-development');
  });

  it('groups repeated failures by skill', () => {
    const summaries = analyzeTrace(FAILURE_TRACE);
    expect(summaries[0].problem).toContain('2');
  });

  it('predicts impact for failures', () => {
    const summaries = analyzeTrace(FAILURE_TRACE);
    expect(summaries[0].predicted_impact.direction).toBe('up');
    expect(summaries[0].predicted_impact.risk.length).toBeGreaterThan(0);
  });

  it('detects unresolved decision points', () => {
    const traceWithUnresolved: SprintTrace = {
      ...SUCCESS_TRACE,
      decision_points: [
        { phase: 2, pause_reason: 'wait_gate1', resolved: false },
      ],
    };
    const summaries = analyzeTrace(traceWithUnresolved);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].problem).toContain('unresolved');
  });
});

describe('formatSummary', () => {
  it('formats summary with all fields', () => {
    const summaries = analyzeTrace(FAILURE_TRACE);
    const formatted = formatSummary(summaries[0]);
    expect(formatted).toContain('## Problem:');
    expect(formatted).toContain('**Root Cause**:');
    expect(formatted).toContain('**Suggestion**:');
    expect(formatted).toContain('**Predicted Impact**:');
    expect(formatted).toContain('**Actual Outcome**: pending verification');
  });
});
