/**
 * Span tracer — builds ENTRY→STEP→LLM/TOOL span tree.
 * Aligned with OTel GenAI semantic conventions.
 *
 * @test REQ-003 Span 调用链追踪器
 * @intent 构建 ENTRY→STEP→LLM/TOOL 的 Span 树结构
 * @covers AC-003-01, AC-003-02, AC-003-03, AC-003-04, AC-003-05, AC-003-06
 */

import fs from 'node:fs';
import path from 'node:path';
import { SpanKind, SpanStatus, createSpan, generateTraceId } from './span-types';
import type { Span, SpanTreeNode, GenAIAttributes } from './span-types';
import { readSprintState } from './sprint-state-io';

export interface SpanTracerOptions {
  projectRoot: string;
  maxDepth?: number;
}

export interface StartSpanOptions {
  name: string;
  kind?: SpanKind;
  attributes?: GenAIAttributes;
}

/**
 * Create a span tracer for the current sprint.
 *
 * @test REQ-003 Span 调用链追踪器
 * @intent 创建 span 追踪器，支持 startSpan/endSpan/getSpans
 * @covers AC-003-01, AC-003-02, AC-003-03
 */
export function createSpanTracer(options: SpanTracerOptions) {
  const maxDepth = options.maxDepth ?? 10;
  const state = readSprintState(options.projectRoot);
  const sprintId = state?.id ?? `trace-${Date.now()}`;
  const traceId = generateTraceId();

  const activeSpans: Span[] = [];
  const completedSpans: Span[] = [];

  /**
   * Start a new span. If there's an active span, it becomes the parent.
   */
  function startSpan(opts: StartSpanOptions): Span {
    // Check depth limit
    const currentDepth = activeSpans.length;
    if (currentDepth >= maxDepth) {
      // Return a dummy span that's immediately ended
      const dummySpan = createSpan({
        name: opts.name,
        kind: opts.kind,
        trace_id: traceId,
        attributes: opts.attributes,
      });
      dummySpan.status = SpanStatus.ERROR;
      dummySpan.error_message = `Max span depth (${maxDepth}) exceeded`;
      dummySpan.end_time_ms = Date.now();
      completedSpans.push(dummySpan);
      return dummySpan;
    }

    const parentSpanId = activeSpans.length > 0
      ? activeSpans[activeSpans.length - 1].context.span_id
      : undefined;

    const span = createSpan({
      name: opts.name,
      kind: opts.kind,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      attributes: opts.attributes,
    });

    activeSpans.push(span);
    return span;
  }

  /**
   * End the most recently started span.
   */
  function endSpan(span: Span, status?: SpanStatus, errorMessage?: string): void {
    span.end_time_ms = Date.now();
    span.status = status ?? SpanStatus.OK;
    if (errorMessage) {
      span.error_message = errorMessage;
    }

    // Remove from active, add to completed
    const idx = activeSpans.findIndex(s => s.context.span_id === span.context.span_id);
    if (idx !== -1) {
      activeSpans.splice(idx, 1);
    }
    completedSpans.push(span);
  }

  /**
   * Get all completed spans.
   */
  function getSpans(): Span[] {
    return [...completedSpans];
  }

  /**
   * Build a span tree from completed spans.
   */
  function getSpanTree(): SpanTreeNode[] {
    const spanMap = new Map<string, SpanTreeNode>();
    const roots: SpanTreeNode[] = [];

    // Create nodes
    for (const span of completedSpans) {
      spanMap.set(span.context.span_id, { span, children: [] });
    }

    // Build tree
    for (const span of completedSpans) {
      const node = spanMap.get(span.context.span_id)!;
      const parentId = span.context.parent_span_id;
      if (parentId && spanMap.has(parentId)) {
        spanMap.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Flush spans to disk (append to spans.jsonl).
   */
  function flush(): void {
    if (completedSpans.length === 0) return;

    const spansDir = path.join(options.projectRoot, '.sprint-state');
    fs.mkdirSync(spansDir, { recursive: true });

    const spansFile = path.join(spansDir, 'spans.jsonl');
    const lines = completedSpans.map(s => JSON.stringify(s)).join('\n') + '\n';
    fs.appendFileSync(spansFile, lines, 'utf8');

    // Clear completed spans after flush
    completedSpans.length = 0;
  }

  return {
    startSpan,
    endSpan,
    getSpans,
    getSpanTree,
    flush,
    traceId,
    sprintId,
  };
}
