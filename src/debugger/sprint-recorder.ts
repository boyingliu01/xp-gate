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

function buildPhaseTimeline(state: { phase_history?: { phase: number; phase_name: string; status: string; timestamp: string }[] }): string[] {
  const phases: string[] = [];
  const seen = new Set<string>();
  for (const ph of state.phase_history || []) {
    const key = `${ph.phase}:${ph.phase_name}`;
    if (!seen.has(key)) {
      seen.add(key);
      phases.push(ph.phase_name);
    }
  }
  return phases;
}

function buildTokenSnapshots(state: { metrics?: Record<string, unknown>; phase_history?: { phase: number; phase_name: string; status: string; timestamp: string }[] }): { phase: string; tokens: number }[] {
  const tokenMap: Record<string, number> = {};
  if (state.metrics && typeof state.metrics === 'object') {
    for (const [key, val] of Object.entries(state.metrics)) {
      if (key.startsWith('tokens_phase_') && typeof val === 'number') {
        const phaseKey = key.replace('tokens_phase_', '');
        tokenMap[phaseKey] = val;
      }
    }
  }
  const snapshots: { phase: string; tokens: number }[] = [];
  for (const ph of state.phase_history || []) {
    const phaseKey = String(ph.phase);
    snapshots.push({
      phase: phaseKey,
      tokens: tokenMap[phaseKey] ?? 0,
    });
  }
  return snapshots;
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
