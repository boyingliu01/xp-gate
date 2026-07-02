import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recordPhaseTransition, recordPhaseTokens } from '../sprint-recorder';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-recorder-test-'));
  fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(phaseHistory: { phase: number; phase_name: string }[]): void {
  const state = {
    id: 'sprint-2026-07-02-01',
    phase: phaseHistory.length > 0 ? phaseHistory[phaseHistory.length - 1].phase : -1,
    status: 'running',
    task_description: 'test sprint',
    started_at: new Date().toISOString(),
    phase_history: phaseHistory.map(ph => ({
      phase: ph.phase,
      phase_name: ph.phase_name,
      status: 'completed',
      timestamp: new Date().toISOString(),
    })),
    metrics: {},
  };
  fs.writeFileSync(
    path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
    JSON.stringify(state, null, 2),
  );
}

function readLog(): string {
  return fs.readFileSync(path.join(tmpDir, '.sprint-state', 'evolution-log.md'), 'utf8');
}

/**
 * Simulate a full sprint run across 5 phases with real token usage.
 */
describe('evolution-log: full sprint flow', () => {
  it('records phase timeline and token usage across a complete sprint', () => {
    // Phase -1: ISOLATE
    writeState([{ phase: -1, phase_name: 'ISOLATE' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: -1, tokensUsed: 500 });

    // Phase -0.5: AUTO-ESTIMATE
    writeState([{ phase: -1, phase_name: 'ISOLATE' }, { phase: -0.5, phase_name: 'AUTO-ESTIMATE' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: -0.5, tokensUsed: 3000 });

    // Phase 0: THINK
    writeState([{ phase: -1, phase_name: 'ISOLATE' }, { phase: -0.5, phase_name: 'AUTO-ESTIMATE' }, { phase: 0, phase_name: 'THINK' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: 0, tokensUsed: 15000 });

    // Phase 1: PLAN
    writeState([{ phase: -1, phase_name: 'ISOLATE' }, { phase: -0.5, phase_name: 'AUTO-ESTIMATE' }, { phase: 0, phase_name: 'THINK' }, { phase: 1, phase_name: 'PLAN' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: 1, tokensUsed: 12000 });

    // Phase 2: BUILD
    writeState([{ phase: -1, phase_name: 'ISOLATE' }, { phase: -0.5, phase_name: 'AUTO-ESTIMATE' }, { phase: 0, phase_name: 'THINK' }, { phase: 1, phase_name: 'PLAN' }, { phase: 2, phase_name: 'BUILD' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: 2, tokensUsed: 35000 });

    const log = readLog();

    // Phase timeline in latest snapshot includes all phases
    expect(log).toContain('ISOLATE');
    expect(log).toContain('AUTO-ESTIMATE');
    expect(log).toContain('THINK');
    expect(log).toContain('PLAN');
    expect(log).toContain('BUILD');

    // Each phase has its token record
    expect(log).toContain('phase: -1, tokens: 500');
    expect(log).toContain('phase: -0.5, tokens: 3000');
    expect(log).toContain('phase: 0, tokens: 15000');
    expect(log).toContain('phase: 1, tokens: 12000');
    expect(log).toContain('phase: 2, tokens: 35000');

    expect(log).toContain('session_id: sprint-2026-07-02-01');
  });

  it('updates token count when recordPhaseTokens is called for the same phase again', () => {
    writeState([{ phase: 0, phase_name: 'THINK' }]);
    recordPhaseTransition({ projectRoot: tmpDir });
    recordPhaseTokens({ projectRoot: tmpDir, phase: 0, tokensUsed: 5000 });

    // Same phase, new tokens (e.g., resume after pause)
    recordPhaseTokens({ projectRoot: tmpDir, phase: 0, tokensUsed: 8000 });

    const log = readLog();
    // Latest snapshot should have updated token count
    const lastSnapshot = log.split('session_id:').filter(Boolean).pop()!;
    expect(lastSnapshot).toContain('tokens: 8000');
    expect(lastSnapshot).not.toContain('tokens: 5000');
  });
});

describe('graceful degradation', () => {
  it('recordPhaseTransition does nothing when sprint-state missing', () => {
    recordPhaseTransition({ projectRoot: tmpDir });
    const logPath = path.join(tmpDir, '.sprint-state', 'evolution-log.md');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('recordPhaseTokens does nothing when sprint-state missing', () => {
    recordPhaseTokens({ projectRoot: tmpDir, phase: 0, tokensUsed: 1000 });
    const logPath = path.join(tmpDir, '.sprint-state', 'evolution-log.md');
    expect(fs.existsSync(logPath)).toBe(false);
  });
});
