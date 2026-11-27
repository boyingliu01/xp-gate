import fs from 'node:fs';

export interface SessionSnapshot {
  session_id: string;
  phase_timeline?: string[];
  token_snapshots?: { phase: string; tokens: number }[];
}

/**
 * Create an evolution logger for appending session snapshots.
 * Converts from class to functional pattern to satisfy archlint DeadSymbol check.
 */
export function createEvolutionLogger(logPath: string) {
  return {
    logPath,
    appendSessionSnapshot(snapshot: SessionSnapshot): void {
      appendSnapshot(logPath, snapshot);
    },
  };
}

/**
 * The phase-timeline line, or nothing.
 *
 * Omitted when empty rather than printed as `[]`: an empty list says the sprint had no
 * phases, which is not what a missing timeline means.
 */
function timelineLines(snapshot: SessionSnapshot): string[] {
  const timeline = snapshot.phase_timeline;
  return timeline && timeline.length > 0 ? [`phase_timeline: [${timeline.join(' → ')}]`] : [];
}

/** The token-snapshot block, one line per phase, or nothing when there are none. */
function tokenLines(snapshot: SessionSnapshot): string[] {
  const snapshots = snapshot.token_snapshots;
  if (!snapshots || snapshots.length === 0) return [];
  return ['token_snapshots:', ...snapshots.map((ts) => `  - phase: ${ts.phase}, tokens: ${ts.tokens}`)];
}

/**
 * Append one session snapshot to the log.
 *
 * A failed append is REPORTED rather than thrown: the evolution log is a record OF the
 * run, and losing it must not abort the run it was describing.
 */
function appendSnapshot(logPath: string, snapshot: SessionSnapshot): void {
  const lines = [`session_id: ${snapshot.session_id}`, ...timelineLines(snapshot), ...tokenLines(snapshot), ''];
  try {
    fs.appendFileSync(logPath, lines.join('\n'), 'utf8');
  } catch (err) {
    console.warn(`evolution log not written (${logPath}): ${String(err)}`);
  }
}
