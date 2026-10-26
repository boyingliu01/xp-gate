import { SprintTrace, ComponentMetric, ComponentName } from './types';

/**
 * Parse every JSONL line, skipping the ones that are not valid JSON.
 *
 * The trace files are append-only and a partially-written last line is normal,
 * so a bad line is data to skip, not an error to raise. Every reader in this
 * module wants the same behaviour, so they share it instead of each carrying its
 * own try/catch.
 */
function parseLines(jsonl: string[]): Record<string, unknown>[] {
  const parsed: Record<string, unknown>[] = [];
  for (const line of jsonl) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') parsed.push(obj);
    } catch {
      continue;
    }
  }
  return parsed;
}

function parseSprintState(jsonl: string[]): string | null {
  for (const obj of parseLines(jsonl)) {
    if (obj.status && typeof obj.phase === 'number') {
      return obj.status as string;
    }
  }
  return null;
}

export function extractToolCalls(jsonl: string[]): SprintTrace['tool_calls'] {
  return parseLines(jsonl)
    .filter((obj) => obj.skill_name && obj.phase !== undefined)
    .map((obj) => ({
      skill_name: obj.skill_name,
      phase: obj.phase,
      timestamp_ms: obj.timestamp ?? Date.now(),
      success: obj.success ?? true,
      duration_ms: obj.duration_ms,
    })) as SprintTrace['tool_calls'];
}

/** Every decision point recorded in the trace, defaulting to the entrance phase. */
function extractDecisionPoints(
  jsonl: string[],
  phaseEntrance: number,
): SprintTrace['decision_points'] {
  return parseLines(jsonl)
    .filter((obj) => obj.decision_point)
    .map((obj) => ({
      phase: obj.phase ?? phaseEntrance,
      pause_reason: obj.pause_reason ?? 'unknown',
      resolved: obj.resolved ?? false,
    })) as SprintTrace['decision_points'];
}

/** Sum of every token count the trace mentions. */
function sumTokens(jsonl: string[]): number {
  return parseLines(jsonl).reduce(
    (sum, obj) => sum + ((obj.tokens_used ?? obj.total_tokens ?? 0) as number),
    0,
  );
}

export function parseTrace(jsonl: string[]): SprintTrace {
  const status = parseSprintState(jsonl);
  const tool_calls = extractToolCalls(jsonl);

  const phases = tool_calls.map((c: { phase: number }) => c.phase);
  const phase_entrance = phases.length > 0 ? Math.min(...phases) : 0;
  const phase_exit = phases.length > 0 ? Math.max(...phases) : 0;

  return {
    sprint_id: `trace-${Date.now()}`,
    phase_entrance,
    phase_exit,
    tool_calls,
    decision_points: extractDecisionPoints(jsonl, phase_entrance),
    total_tokens: sumTokens(jsonl),
    status: (status as SprintTrace['status']) ?? 'completed',
  };
}

export function trackComponentMetrics(
  evolutionHistory: { component_changes: ComponentName[]; date: string }[],
): ComponentMetric[] {
  const counts: Record<ComponentName, { count: number; lastModified: string }> = {
    'system-prompt': { count: 0, lastModified: '' },
    'tools': { count: 0, lastModified: '' },
    'middleware': { count: 0, lastModified: '' },
    'memory': { count: 0, lastModified: '' },
    'skill-invocations': { count: 0, lastModified: '' },
  };

  for (const entry of evolutionHistory) {
    for (const comp of entry.component_changes) {
      const current = counts[comp];
      current.count += 1;
      if (entry.date > current.lastModified) {
        current.lastModified = entry.date;
      }
    }
  }

  return (Object.keys(counts) as ComponentName[]).map((comp) => ({
    component: comp,
    change_count: counts[comp].count,
    last_modified: counts[comp].lastModified,
  }));
}
