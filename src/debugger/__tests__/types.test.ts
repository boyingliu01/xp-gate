import { describe, it, expect } from 'vitest';
import type { SprintTrace, ComponentMetric, ComponentName } from '../types';
import type { Span } from '../span-types';

/**
 * @test REQ-005 类型扩展
 * @intent 验证 SprintTrace 新增 spans 和 token_deltas 字段向后兼容
 * @covers AC-005-01, AC-005-02, AC-005-03
 */
describe('types extension (REQ-005)', () => {
  describe('SprintTrace backward compatibility', () => {
    it('existing SprintTrace usage still works without new fields', () => {
      const trace: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 1000,
        status: 'completed',
      };

      expect(trace.sprint_id).toBe('sprint-001');
      expect(trace.status).toBe('completed');
    });

    it('spans field is optional', () => {
      const traceWithoutSpans: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 1000,
        status: 'completed',
      };

      expect(traceWithoutSpans.spans).toBeUndefined();
    });

    it('token_deltas field is optional', () => {
      const traceWithoutDeltas: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 1000,
        status: 'completed',
      };

      expect(traceWithoutDeltas.token_deltas).toBeUndefined();
    });

    it('spans field accepts Span array', () => {
      const trace: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 1000,
        status: 'completed',
        spans: [
          {
            context: { span_id: 'abc123', trace_id: 'trace-1' },
            name: 'session',
            kind: 'INTERNAL' as Span['kind'],
            start_time_ms: Date.now(),
            status: 'OK' as Span['status'],
          },
        ],
      };

      expect(trace.spans).toHaveLength(1);
      expect(trace.spans![0].name).toBe('session');
    });

    it('token_deltas field accepts delta record array', () => {
      const trace: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 2000,
        status: 'completed',
        token_deltas: [
          {
            sprint_id: 'sprint-001',
            timestamp: '2026-07-02T00:00:00.000Z',
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: 100,
            cache_write_tokens: 50,
            total_tokens: 1500,
            delta_input: 1000,
            delta_output: 500,
            delta_total: 1500,
            phase: 0,
          },
        ],
      };

      expect(trace.token_deltas).toHaveLength(1);
      expect(trace.token_deltas![0].delta_input).toBe(1000);
    });

    it('both new fields can coexist', () => {
      const trace: SprintTrace = {
        sprint_id: 'sprint-001',
        phase_entrance: 0,
        phase_exit: 2,
        tool_calls: [],
        decision_points: [],
        total_tokens: 2000,
        status: 'completed',
        spans: [],
        token_deltas: [],
      };

      expect(trace.spans).toEqual([]);
      expect(trace.token_deltas).toEqual([]);
    });
  });

  describe('existing types unchanged', () => {
    it('ComponentMetric still works', () => {
      const metric: ComponentMetric = {
        component: 'system-prompt',
        change_count: 3,
        last_modified: '2026-07-02',
      };

      expect(metric.component).toBe('system-prompt');
    });

    it('ComponentName union unchanged', () => {
      const name: ComponentName = 'tools';
      expect(name).toBe('tools');
    });
  });
});
