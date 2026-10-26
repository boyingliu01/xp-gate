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
 * All mutable tracer state, threaded explicitly.
 *
 * The five operations used to be nested closures over two arrays, which Gate 3
 * counts as a single CCN-16 function: the tool measures branches reachable within
 * one function body and does not split on closure boundaries. Passing the state
 * in lets each operation sit at module scope where it is small and directly
 * testable.
 */
interface TracerState {
  readonly projectRoot: string;
  readonly maxDepth: number;
  readonly traceId: string;
  readonly sprintId: string;
  activeSpans: Span[];
  completedSpans: Span[];
}

/** The span a child should point at: the most recently started, still-open one. */
function currentParentId(state: TracerState): string | undefined {
  if (state.activeSpans.length === 0) return undefined;
  return state.activeSpans[state.activeSpans.length - 1].context.span_id;
}

/**
 * A span for a call that exceeded maxDepth. It is ended immediately and recorded
 * as an error, so the overflow is visible in the trace rather than lost.
 */
function overflowSpan(state: TracerState, opts: StartSpanOptions): Span {
  const span = createSpan({
    name: opts.name,
    kind: opts.kind,
    trace_id: state.traceId,
    attributes: opts.attributes,
  });
  span.status = SpanStatus.ERROR;
  span.error_message = `Max span depth (${state.maxDepth}) exceeded`;
  span.end_time_ms = Date.now();
  state.completedSpans.push(span);
  return span;
}

function startSpan(state: TracerState, opts: StartSpanOptions): Span {
  if (state.activeSpans.length >= state.maxDepth) {
    return overflowSpan(state, opts);
  }

  const span = createSpan({
    name: opts.name,
    kind: opts.kind,
    trace_id: state.traceId,
    parent_span_id: currentParentId(state),
    attributes: opts.attributes,
  });
  state.activeSpans.push(span);
  return span;
}

function endSpan(
  state: TracerState,
  span: Span,
  status?: SpanStatus,
  errorMessage?: string,
): void {
  span.end_time_ms = Date.now();
  span.status = status ?? SpanStatus.OK;
  if (errorMessage) {
    span.error_message = errorMessage;
  }

  // Remove from active, add to completed.
  const idx = state.activeSpans.findIndex((s) => s.context.span_id === span.context.span_id);
  if (idx !== -1) {
    state.activeSpans.splice(idx, 1);
  }
  state.completedSpans.push(span);
}

/** Attach each span to its parent node, collecting the parentless as roots. */
function buildSpanTree(spans: Span[]): SpanTreeNode[] {
  const spanMap = new Map<string, SpanTreeNode>();
  const roots: SpanTreeNode[] = [];

  for (const span of spans) {
    spanMap.set(span.context.span_id, { span, children: [] });
  }

  for (const span of spans) {
    const node = spanMap.get(span.context.span_id)!;
    const parentId = span.context.parent_span_id;
    const parent = parentId ? spanMap.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Append completed spans to `spans.jsonl`.
 *
 * The buffer is cleared only after the write succeeds. It used to be cleared
 * unconditionally, so a failed write (full disk, read-only worktree) silently
 * discarded every span collected so far — the tracer would look like it worked
 * while losing the data it exists to record.
 */
function flushSpans(state: TracerState): void {
  if (state.completedSpans.length === 0) return;

  const spansDir = path.join(state.projectRoot, '.sprint-state');
  try {
    fs.mkdirSync(spansDir, { recursive: true });
    const lines = state.completedSpans.map((s) => JSON.stringify(s)).join('\n') + '\n';
    fs.appendFileSync(path.join(spansDir, 'spans.jsonl'), lines, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[span-tracer] flush failed, keeping ${state.completedSpans.length} span(s): ${detail}\n`);
    return;
  }

  // Clear only what was actually written.
  state.completedSpans.length = 0;
}

/**
 * Create a span tracer for the current sprint.
 *
 * @test REQ-003 Span 调用链追踪器
 * @intent 创建 span 追踪器，支持 startSpan/endSpan/getSpans
 * @covers AC-003-01, AC-003-02, AC-003-03
 */
export function createSpanTracer(options: SpanTracerOptions) {
  const sprintState = readSprintState(options.projectRoot);
  const state: TracerState = {
    projectRoot: options.projectRoot,
    maxDepth: options.maxDepth ?? 10,
    traceId: generateTraceId(),
    sprintId: sprintState?.id ?? `trace-${Date.now()}`,
    activeSpans: [],
    completedSpans: [],
  };

  return {
    startSpan: (opts: StartSpanOptions): Span => startSpan(state, opts),
    endSpan: (span: Span, status?: SpanStatus, errorMessage?: string): void =>
      endSpan(state, span, status, errorMessage),
    getSpans: (): Span[] => [...state.completedSpans],
    getSpanTree: (): SpanTreeNode[] => buildSpanTree(state.completedSpans),
    flush: (): void => flushSpans(state),
    traceId: state.traceId,
    sprintId: state.sprintId,
  };
}
