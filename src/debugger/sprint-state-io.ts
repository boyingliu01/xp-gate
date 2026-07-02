/**
 * Shared sprint state I/O — read/write sprint-state.json.
 *
 * Extracted to eliminate code clone between sprint-recorder.ts and token-delta.ts.
 *
 * @test REQ-002 Token 差分采集器
 * @intent 提供 sprint-state.json 的共享读写函数，消除重复代码
 * @covers AC-002-01
 */

import fs from 'node:fs';
import path from 'node:path';

export interface SprintState {
  id?: string;
  phase?: number;
  phase_history?: { phase: number; phase_name: string; status: string; timestamp: string }[];
  metrics?: Record<string, unknown>;
}

export function readSprintState(root: string): SprintState | null {
  try {
    const stateFile = path.join(root, '.sprint-state', 'sprint-state.json');
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSprintState(root: string, state: SprintState): void {
  const stateFile = path.join(root, '.sprint-state', 'sprint-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}
