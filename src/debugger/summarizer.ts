import { SprintTrace, IterationSummary, Prediction } from './types';

export function analyzeTrace(trace: SprintTrace): IterationSummary[] {
  const failures = trace.tool_calls.filter((tc) => !tc.success);
  const summaries: IterationSummary[] = [];

  if (failures.length > 0) {
    const grouped = new Map<string, typeof failures>();
    for (const failure of failures) {
      const key = failure.skill_name;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(failure);
    }

    for (const [skill, skillFailures] of grouped) {
      summaries.push({
        problem: `${skill} failed ${skillFailures.length} time(s) during sprint ${trace.sprint_id}`,
        root_cause: inferRootCause(skillFailures),
        suggestion: generateSuggestion(skill, skillFailures),
        predicted_impact: {
          metric: 'pass_rate',
          direction: 'up',
          delta_pct: Math.min(skillFailures.length * 5, 30),
          risk: `Fixing ${skill} may affect downstream phase execution`,
        },
        actual_impact: null,
      });
    }
  }

  if (trace.decision_points.length > 0) {
    const unresolved = trace.decision_points.filter((dp) => !dp.resolved);
    if (unresolved.length > 0) {
      summaries.push({
        problem: `${unresolved.length} decision point(s) unresolved in sprint ${trace.sprint_id}`,
        root_cause: 'Pause-point logic blocked transition without resolution',
        suggestion: 'Review middleware pause-point thresholds and add fallback recovery',
        predicted_impact: {
          metric: 'sprint_duration',
          direction: 'down',
          delta_pct: unresolved.length * 10,
          risk: 'Adjusting pause points may skip necessary user confirmations',
        },
        actual_impact: null,
      });
    }
  }

  return summaries;
}

function inferRootCause(failures: SprintTrace['tool_calls']): string {
  const repeated = failures.length > 1;
  const names = [...new Set(failures.map((f) => f.skill_name))];

  if (repeated) {
    return `Repeated failure in ${names[0]} across multiple invocations`;
  }

  return `Single-point failure in ${names[0]} at phase ${failures[0]?.phase}`;
}

function generateSuggestion(skillName: string, failures: SprintTrace['tool_calls']): string {
  return `Investigate ${skillName} failure pattern; check skill invocation mapping and parameter routing`;
}

export function formatSummary(summary: IterationSummary): string {
  return [
    `## Problem: ${summary.problem}`,
    `**Root Cause**: ${summary.root_cause}`,
    `**Suggestion**: ${summary.suggestion}`,
    `**Predicted Impact**: ${summary.predicted_impact.metric} ${summary.predicted_impact.direction} by ${summary.predicted_impact.delta_pct}%`,
    `**Risk**: ${summary.predicted_impact.risk}`,
    summary.actual_impact
      ? `**Actual Outcome**: prediction correct: ${summary.actual_impact.prediction_correct}`
      : `**Actual Outcome**: pending verification`,
  ].join('\n');
}
