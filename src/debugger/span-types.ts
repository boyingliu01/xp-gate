/**
 * OTel GenAI Semantic Conventions types
 * Aligned with OTel GenAI Semantic Conventions v1.24+
 * Reference: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * @test REQ-001 OTel GenAI 语义规范类型定义
 * @intent 定义对齐 OTel GenAI Semantic Conventions 的 TypeScript 类型
 * @covers AC-001-01, AC-001-02, AC-001-03, AC-001-04
 */

/**
 * Span kind枚举 — 对齐 OTel SpanKind
 */
export enum SpanKind {
  INTERNAL = 'INTERNAL',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  PRODUCER = 'PRODUCER',
  CONSUMER = 'CONSUMER',
}

/**
 * Span status — 对齐 OTel SpanStatus
 */
export enum SpanStatus {
  UNSET = 'UNSET',
  OK = 'OK',
  ERROR = 'ERROR',
}

/**
 * GenAI operation types — 对齐 OTel GenAI semantic conventions
 */
type GenAIOperationType =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'text_generation'
  | 'summarization'
  | 'translation'
  | 'tool_call';

/**
 * GenAI model attributes
 */
export interface GenAIModelAttributes {
  /** Model name (e.g., 'gpt-4', 'deepseek-v4-pro') */
  model: string;
  /** Model provider (e.g., 'openai', 'deepseek', 'kimi') */
  model_provider?: string;
  /** Model version */
  model_version?: string;
}

/**
 * GenAI token usage — 对齐 OTel GenAI token usage semantic conventions
 */
export interface GenAITokenUsage {
  /** Number of input tokens */
  input_tokens: number;
  /** Number of output tokens */
  output_tokens: number;
  /** Number of tokens read from cache */
  cache_read_tokens?: number;
  /** Number of tokens written to cache */
  cache_write_tokens?: number;
  /** Total tokens (input + output) */
  total_tokens: number;
}

/**
 * GenAI specific attributes
 */
export interface GenAIAttributes extends GenAIModelAttributes {
  /** Operation type */
  operation: GenAIOperationType;
  /** Token usage */
  token_usage?: GenAITokenUsage;
  /** Request ID */
  request_id?: string;
  /** Response finish reason */
  finish_reason?: string;
}

/**
 * Span context — parent-child relationship
 */
export interface SpanContext {
  /** Span ID */
  span_id: string;
  /** Parent span ID (null for root spans) */
  parent_span_id?: string;
  /** Trace ID */
  trace_id: string;
}

/**
 * Span — aligned with OTel GenAI semantic conventions
 */
export interface Span {
  /** Span context */
  context: SpanContext;
  /** Span name (e.g., 'session', 'phase', 'llm', 'tool') */
  name: string;
  /** Span kind */
  kind: SpanKind;
  /** Start timestamp (ms) */
  start_time_ms: number;
  /** End timestamp (ms, null if still active) */
  end_time_ms?: number;
  /** Span status */
  status: SpanStatus;
  /** GenAI specific attributes */
  attributes?: GenAIAttributes;
  /** Error message (if status === ERROR) */
  error_message?: string;
}

/**
 * Span tree node — for building parent-child relationships
 */
export interface SpanTreeNode {
  span: Span;
  children: SpanTreeNode[];
}

/**
 * Create a new span with defaults
 */
export function createSpan(params: {
  name: string;
  kind?: SpanKind;
  trace_id: string;
  parent_span_id?: string;
  attributes?: GenAIAttributes;
}): Span {
  return {
    context: {
      span_id: generateSpanId(),
      parent_span_id: params.parent_span_id,
      trace_id: params.trace_id,
    },
    name: params.name,
    kind: params.kind ?? SpanKind.INTERNAL,
    start_time_ms: Date.now(),
    status: SpanStatus.UNSET,
    attributes: params.attributes,
  };
}

/**
 * Generate a random span ID (8 hex chars)
 */
function generateSpanId(): string {
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Generate a random trace ID (16 hex chars)
 */
export function generateTraceId(): string {
  return Math.random().toString(16).slice(2, 18);
}
