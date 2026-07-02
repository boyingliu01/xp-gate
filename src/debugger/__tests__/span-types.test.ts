import { describe, it, expect } from 'vitest';
import { SpanKind, SpanStatus, createSpan, generateTraceId } from '../span-types';

/**
 * @test REQ-001 OTel GenAI 语义规范类型定义
 * @intent 验证 span-types 类型定义和工厂函数
 * @covers AC-001-01, AC-001-02, AC-001-03, AC-001-04
 */
describe('span-types', () => {
  describe('SpanKind', () => {
    it('contains all OTel span kinds', () => {
      expect(SpanKind.INTERNAL).toBe('INTERNAL');
      expect(SpanKind.SERVER).toBe('SERVER');
      expect(SpanKind.CLIENT).toBe('CLIENT');
      expect(SpanKind.PRODUCER).toBe('PRODUCER');
      expect(SpanKind.CONSUMER).toBe('CONSUMER');
    });
  });

  describe('SpanStatus', () => {
    it('contains all OTel span statuses', () => {
      expect(SpanStatus.UNSET).toBe('UNSET');
      expect(SpanStatus.OK).toBe('OK');
      expect(SpanStatus.ERROR).toBe('ERROR');
    });
  });

  describe('createSpan', () => {
    it('creates a span with required fields', () => {
      const span = createSpan({
        name: 'test-span',
        trace_id: 'trace-123',
      });

      expect(span.name).toBe('test-span');
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.status).toBe(SpanStatus.UNSET);
      expect(span.context.trace_id).toBe('trace-123');
      expect(span.context.span_id).toHaveLength(8);
      expect(span.start_time_ms).toBeGreaterThan(0);
    });

    it('creates a span with parent', () => {
      const span = createSpan({
        name: 'child-span',
        trace_id: 'trace-123',
        parent_span_id: 'parent-123',
      });

      expect(span.context.parent_span_id).toBe('parent-123');
    });

    it('creates a span with custom kind', () => {
      const span = createSpan({
        name: 'server-span',
        trace_id: 'trace-123',
        kind: SpanKind.SERVER,
      });

      expect(span.kind).toBe(SpanKind.SERVER);
    });

    it('creates a span with GenAI attributes', () => {
      const span = createSpan({
        name: 'llm-span',
        trace_id: 'trace-123',
        attributes: {
          model: 'deepseek-v4-pro',
          operation: 'chat',
        },
      });

      expect(span.attributes?.model).toBe('deepseek-v4-pro');
      expect(span.attributes?.operation).toBe('chat');
    });
  });

  describe('generateTraceId', () => {
    it('generates a unique trace ID', () => {
      const id1 = generateTraceId();
      const id2 = generateTraceId();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(0);
    });
  });
});
