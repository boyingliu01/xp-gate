export type ComponentName =
  | 'system-prompt'
  | 'tools'
  | 'middleware'
  | 'memory'
  | 'skill-invocations';

export type MetricName =
  | 'pass_rate'
  | 'token_per_sprint'
  | 'sprint_duration'
  | 'failure_mode_count';

export type BaselineMetric = 'component-attribution-accuracy' | 'skill-consistency';

export interface Prediction {
  metric: MetricName | BaselineMetric;
  direction: 'up' | 'down';
  delta_pct: number;
  risk: string;
}

export interface ActualOutcome {
  before: Record<string, number>;
  after: Record<string, number>;
  prediction_correct: boolean;
}

export interface IterationSummary {
  problem: string;
  root_cause: string;
  suggestion: string;
  predicted_impact: Prediction;
  actual_impact: ActualOutcome | null;
}

export interface SprintTrace {
  sprint_id: string;
  phase_entrance: number;
  phase_exit: number;
  tool_calls: {
    skill_name: string;
    phase: number;
    timestamp_ms: number;
    success: boolean;
    duration_ms?: number;
  }[];
  decision_points: {
    phase: number;
    pause_reason: string;
    resolved: boolean;
  }[];
  total_tokens: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  /** OTel GenAI span tree (optional, enabled via --observability) */
  spans?: import('./span-types').Span[];
  /** Token delta history per LLM call (optional, enabled via --observability) */
  token_deltas?: {
    sprint_id: string;
    timestamp: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_tokens: number;
    delta_input: number;
    delta_output: number;
    delta_total: number;
    phase?: number;
  }[];
}

export interface ComponentMetric {
  component: ComponentName;
  change_count: number;
  last_modified: string;
  contribution_to_pass_rate?: number;
}
