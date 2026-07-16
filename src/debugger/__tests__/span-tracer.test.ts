import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSpanTracer } from '../span-tracer';
import { SpanKind, SpanStatus } from '../span-types';

/**
 * @test REQ-003 Span 调用链追踪器
 * @intent 验证 span 树构建、深度限制、持久化
 * @covers AC-003-01, AC-003-02, AC-003-03, AC-003-04, AC-003-05, AC-003-06
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'span-tracer-test-'));
  fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
    JSON.stringify({ id: 'sprint-test-001', phase: 0, status: 'running' }, null, 2),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createSpanTracer', () => {
  it('creates a tracer with traceId and sprintId', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });
    expect(tracer.traceId).toBeTruthy();
    expect(tracer.sprintId).toBe('sprint-test-001');
  });

  it('starts and ends a span', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });

    const span = tracer.startSpan({ name: 'test-span' });
    expect(span.name).toBe('test-span');
    expect(span.status).toBe(SpanStatus.UNSET);
    expect(span.end_time_ms).toBeUndefined();

    tracer.endSpan(span);
    expect(span.end_time_ms).toBeGreaterThan(0);
    expect(span.status).toBe(SpanStatus.OK);
  });

  it('builds parent-child relationships', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });

    const parent = tracer.startSpan({ name: 'session' });
    const child = tracer.startSpan({ name: 'phase' });

    expect(child.context.parent_span_id).toBe(parent.context.span_id);

    tracer.endSpan(child);
    tracer.endSpan(parent);

    const tree = tracer.getSpanTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].span.name).toBe('session');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].span.name).toBe('phase');
  });

  it('builds deep span tree (session → phase → llm → tool)', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });

    const session = tracer.startSpan({ name: 'session' });
    const phase = tracer.startSpan({ name: 'phase' });
    const llm = tracer.startSpan({ name: 'llm', kind: SpanKind.CLIENT });
    const tool = tracer.startSpan({ name: 'tool' });

    tracer.endSpan(tool);
    tracer.endSpan(llm);
    tracer.endSpan(phase);
    tracer.endSpan(session);

    const tree = tracer.getSpanTree();
    expect(tree[0].children[0].children[0].children[0].span.name).toBe('tool');
  });

  it('enforces max depth limit', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir, maxDepth: 2 });

    const s1 = tracer.startSpan({ name: 'span-1' });
    const s2 = tracer.startSpan({ name: 'span-2' });
    const s3 = tracer.startSpan({ name: 'span-3' }); // Should hit limit

    expect(s3.status).toBe(SpanStatus.ERROR);
    expect(s3.error_message).toContain('Max span depth');

    tracer.endSpan(s2);
    tracer.endSpan(s1);

    const spans = tracer.getSpans();
    // s3 was immediately completed with error
    expect(spans.some(s => s.name === 'span-3' && s.status === SpanStatus.ERROR)).toBe(true);
  });

  it('records GenAI attributes on spans', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });

    const span = tracer.startSpan({
      name: 'llm',
      kind: SpanKind.CLIENT,
      attributes: {
        model: 'deepseek-v4-pro',
        operation: 'chat',
      },
    });

    expect(span.attributes?.model).toBe('deepseek-v4-pro');
    expect(span.attributes?.operation).toBe('chat');

    tracer.endSpan(span);
  });

  it('flushes spans to disk', () => {
    const tracer = createSpanTracer({ projectRoot: tmpDir });

    const span = tracer.startSpan({ name: 'test' });
    tracer.endSpan(span);
    tracer.flush();

    const spansFile = path.join(tmpDir, '.sprint-state', 'spans.jsonl');
    expect(fs.existsSync(spansFile)).toBe(true);

    const content = fs.readFileSync(spansFile, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.name).toBe('test');
  });

  it('handles missing sprint state gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
      '{}',
    );

    const tracer = createSpanTracer({ projectRoot: tmpDir });
    // After migration, empty state gets a generated sprint ID
    expect(tracer.sprintId).toMatch(/^sprint-/);
  });
});
