import path from 'node:path';
import { createEvolutionLogger } from './evolution-logger';
import { readSprintState, writeSprintState } from './sprint-state-io';

export interface PhaseTransitionOptions {
  projectRoot: string;
}

export interface PhaseTokenOptions {
  projectRoot: string;
  phase: number;
  tokensUsed: number;
}

/** One entry of a sprint's phase history. */
interface PhaseHistoryEntry {
  phase: number;
  phase_name: string;
  status: string;
  timestamp?: string;
  started_at?: string;
}

/**
 * The part of the sprint state this module reads.
 *
 * A named interface rather than an inline literal: the inline form repeated the same
 * six-field shape at every parameter, and each optional marker counted as a decision.
 */
interface RecordableState {
  metrics?: Record<string, unknown>;
  phase_history?: PhaseHistoryEntry[];
}

function buildPhaseTimeline(state: RecordableState): string[] {
  return uniquePhaseNames(state.phase_history || []);
}

/** The phase names in first-seen order, one per phase. */
function uniquePhaseNames(history: Array<{ phase: number; phase_name: string }>): string[] {
  const byKey = new Map<string, string>();
  for (const ph of history) {
    if (!byKey.has(phaseKeyOf(ph))) byKey.set(phaseKeyOf(ph), ph.phase_name);
  }
  return [...byKey.values()];
}

/**
 * The key that makes two history entries the same phase.
 *
 * NUMBER AND NAME together: a phase that was renamed mid-sprint is the same phase, and
 * one that reused a name for a different number is not.
 */
function phaseKeyOf(ph: { phase: number; phase_name: string }): string {
  return `${ph.phase}:${ph.phase_name}`;
}

/** The metrics prefix that carries per-phase token counts. */
const TOKEN_PHASE_PREFIX = 'tokens_phase_';

/**
 * Per-phase token counts, keyed by the phase number the metric name carries.
 *
 * Read from `metrics`, not from the timeline: a phase that ran and then had its history
 * entry rewritten still spent its tokens, and the metric is the only place that
 * survives the rewrite.
 */
function collectPhaseTokens(metrics: Record<string, unknown> | undefined): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics ?? {})) {
    if (!key.startsWith(TOKEN_PHASE_PREFIX) || typeof value !== 'number') continue;
    tokens[key.replace(TOKEN_PHASE_PREFIX, '')] = value;
  }
  return tokens;
}

/**
 * One snapshot per phase in the history, with its tokens.
 *
 * A phase with no recorded count reports 0 rather than being omitted: the timeline is
 * the spine of the report, and dropping entries would make it silently disagree with
 * the phase list.
 */
function buildTokenSnapshots(state: RecordableState): { phase: string; tokens: number }[] {
  const tokenMap = collectPhaseTokens(state.metrics);
  return (state.phase_history || []).map((ph) => snapshotFor(ph, tokenMap));
}

/**
 * One phase's snapshot, defaulting its token count to 0.
 *
 * 0 rather than omission: the timeline is the spine of the report, and a missing entry
 * would make it silently disagree with the phase list printed beside it.
 */
function snapshotFor(ph: { phase: number }, tokenMap: Record<string, number>) {
  const phaseKey = String(ph.phase);
  return { phase: phaseKey, tokens: tokensFor(tokenMap, phaseKey) };
}

/** A phase's token count, or 0 when none was recorded. */
function tokensFor(tokenMap: Record<string, number>, phaseKey: string): number {
  return tokenMap[phaseKey] ?? 0;
}

/**
 * Record a phase transition snapshot to evolution-log.md.
 * Call this after updating sprint-state.json at each Phase completion.
 */
export function recordPhaseTransition(options: PhaseTransitionOptions): void {
  const state = readSprintState(options.projectRoot);
  if (!state?.id) return;

  const logPath = path.join(options.projectRoot, '.sprint-state', 'evolution-log.md');
  const logger = createEvolutionLogger(logPath);

  const phaseTimeline = buildPhaseTimeline(state);
  const tokenSnapshots = buildTokenSnapshots(state);

  logger.appendSessionSnapshot({
    session_id: state.id,
    phase_timeline: phaseTimeline,
    token_snapshots: tokenSnapshots,
  });
}

/**
 * Record token usage for a specific phase.
 * Stores token count in sprint-state.json metrics and updates evolution-log.md.
 */
export function recordPhaseTokens(options: PhaseTokenOptions): void {
  const state = readSprintState(options.projectRoot);
  if (!state?.id) return;

  // Persist token count to sprint state metrics
  if (!state.metrics) state.metrics = {};
  const key = `tokens_phase_${options.phase}`;
  (state.metrics as Record<string, unknown>)[key] = options.tokensUsed;
  writeSprintState(options.projectRoot, state);

  // Record snapshot with updated token data
  recordPhaseTransition({ projectRoot: options.projectRoot });
}
