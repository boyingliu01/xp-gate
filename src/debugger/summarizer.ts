import { SprintTrace, IterationSummary } from './types';

/** Failures grouped by the skill that produced them. */
function groupBySkill(failures: SprintTrace['tool_calls']): Map<string, SprintTrace['tool_calls']> {
  const grouped = new Map<string, SprintTrace['tool_calls']>();
  for (const failure of failures) {
    const bucket = grouped.get(failure.skill_name);
    if (bucket) bucket.push(failure);
    else grouped.set(failure.skill_name, [failure]);
  }
  return grouped;
}

/** A predicted pass-rate gain of 5 points per failure, capped so one bad skill cannot
 * dominate the estimate. */
const DELTA_PER_FAILURE = 5;
const DELTA_CAP = 30;

/**
 * The iteration summary for one repeatedly-failing skill.
 *
 * Grouped by SKILL rather than by call because the reader acts on the skill: ten
 * failures of one tool is one thing to fix, not ten.
 */
function summariseSkill(
  skill: string,
  skillFailures: SprintTrace['tool_calls'],
  sprintId: string,
): IterationSummary {
  return {
    problem: `${skill} failed ${skillFailures.length} time(s) during sprint ${sprintId}`,
    root_cause: inferRootCause(skillFailures),
    suggestion: generateSuggestion(skill, skillFailures),
    predicted_impact: {
      metric: 'pass_rate',
      direction: 'up',
      delta_pct: Math.min(skillFailures.length * DELTA_PER_FAILURE, DELTA_CAP),
      risk: `Fixing ${skill} may affect downstream phase execution`,
    },
    actual_impact: null,
  };
}

export function analyzeTrace(trace: SprintTrace): IterationSummary[] {
  const failures = trace.tool_calls.filter((tc) => !tc.success);
  const summaries: IterationSummary[] = [];

  if (failures.length > 0) {
    for (const [skill, skillFailures] of groupBySkill(failures)) {
      summaries.push(summariseSkill(skill, skillFailures, trace.sprint_id));
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

function inferRootCause(_failures: SprintTrace['tool_calls']): string {
  const repeated = _failures.length > 1;
  const names = [...new Set(_failures.map((f) => f.skill_name))];

  if (repeated) {
    return `Repeated failure in ${names[0]} across multiple invocations`;
  }

  return `Single-point failure in ${names[0]} at phase ${_failures[0]?.phase}`;
}

function generateSuggestion(skillName: string, _failures: SprintTrace['tool_calls']): string {
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
