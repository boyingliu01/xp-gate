import { SprintTrace, ComponentMetric, ComponentName } from './types';

function parseSprintState(jsonl: string[]): string | null {
  for (const line of jsonl) {
    try {
      const obj = JSON.parse(line);
      if (obj.status && typeof obj.phase === 'number') {
        return obj.status;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function extractToolCalls(jsonl: string[]): SprintTrace['tool_calls'] {
  const calls: SprintTrace['tool_calls'] = [];
  for (const line of jsonl) {
    try {
      const obj = JSON.parse(line);
      if (obj.skill_name && obj.phase !== undefined) {
        calls.push({
          skill_name: obj.skill_name,
          phase: obj.phase,
          timestamp_ms: obj.timestamp ?? Date.now(),
          success: obj.success ?? true,
          duration_ms: obj.duration_ms,
        });
      }
    } catch {
      continue;
    }
  }
  return calls;
}

export function parseTrace(jsonl: string[]): SprintTrace {
  const status = parseSprintState(jsonl);
  const tool_calls = extractToolCalls(jsonl);

  const phases = tool_calls.map((c: { phase: number }) => c.phase);
  const phase_entrance = phases.length > 0 ? Math.min(...phases) : 0;
  const phase_exit = phases.length > 0 ? Math.max(...phases) : 0;

  const decision_points: SprintTrace['decision_points'] = [];
  for (const line of jsonl) {
    try {
      const obj = JSON.parse(line);
      if (obj.decision_point) {
        decision_points.push({
          phase: obj.phase ?? phase_entrance,
          pause_reason: obj.pause_reason ?? 'unknown',
          resolved: obj.resolved ?? false,
        });
      }
    } catch {
      continue;
    }
  }

  const total_tokens = jsonl.reduce((sum: number, line: string) => {
    try {
      const obj = JSON.parse(line);
      return sum + (obj.tokens_used ?? obj.total_tokens ?? 0);
    } catch {
      return sum;
    }
  }, 0);

  return {
    sprint_id: `trace-${Date.now()}`,
    phase_entrance,
    phase_exit,
    tool_calls,
    decision_points,
    total_tokens,
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
