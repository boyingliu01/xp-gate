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
      const lines: string[] = [];

      lines.push(`session_id: ${snapshot.session_id}`);

      if (snapshot.phase_timeline && snapshot.phase_timeline.length > 0) {
        lines.push(`phase_timeline: [${snapshot.phase_timeline.join(' → ')}]`);
      }

      if (snapshot.token_snapshots && snapshot.token_snapshots.length > 0) {
        lines.push('token_snapshots:');
        for (const ts of snapshot.token_snapshots) {
          lines.push(`  - phase: ${ts.phase}, tokens: ${ts.tokens}`);
        }
      }

      lines.push('');
      fs.appendFileSync(logPath, lines.join('\n'), 'utf8');
    },
  };
}
