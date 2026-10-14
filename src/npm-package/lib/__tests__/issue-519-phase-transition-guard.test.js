/**
 * @intent #519: A real pointer-drift incident (#507) showed that a MISSED
 *         phase transition is invisible — the state file cannot distinguish
 *         "never ran" from "not yet advanced". Guards under test:
 *           (1) sequence guard: `completed` on phase n is refused unless phase
 *               n-1 is completed/skipped, with `--force` as the explicit escape;
 *           (2) before/after echo so "command didn't run" and "ran without
 *               effect" are distinguishable in the output;
 *           (3) an append-only transition audit log;
 *           (4) phase_history field normalization (`name` → `phase_name`).
 * @covers handlePhaseTransition guard/echo, appendTransitionAudit, migrateState
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePhaseTransition } from '../phase-transition.js';
import { SprintStateManager } from '../sprint-state-manager.js';
import { migrateState } from '../sprint-state-migrator.js';

function writeState(dir, state) {
  try {
    fs.mkdirSync(path.join(dir, '.sprint-state'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.sprint-state', 'sprint-state.json'),
      JSON.stringify(state, null, 2),
    );
  } catch (err) {
    throw new Error(`writeState failed for ${dir}: ${err.message}`);
  }
}

function baseState(overrides = {}) {
  return {
    _schema_version: 1,
    id: 'sprint-519',
    task_description: 'test',
    phase: 2,
    status: 'in_progress',
    started_at: '2026-10-14T00:00:00Z',
    phase_history: [],
    isolation: { worktree_path: null, branch: null },
    ...overrides,
  };
}

describe('#519 phase-transition sequence guard', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p519-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses `completed` on phase 3 when phase 2 is not completed/skipped', async () => {
    writeState(dir, baseState({
      phase: 3,
      phase_history: [{ phase: 2, phase_name: 'DESIGN', status: 'in_progress' }],
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await handlePhaseTransition(['3', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    const stderr = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(stderr).toContain('Cannot complete phase 3');
    expect(stderr).toContain('phase 2');
    expect(stderr).toContain('phase history');
  });

  it('refuses the jump and names --force as the override', async () => {
    writeState(dir, baseState({ phase: 3, phase_history: [] }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handlePhaseTransition(['5', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    const stderr = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    errSpy.mockRestore();
    expect(stderr).toContain('--force');
  });

  it('allows `completed` when the previous phase is completed', async () => {
    writeState(dir, baseState({
      phase: 2,
      phase_history: [{ phase: 2, phase_name: 'DESIGN', status: 'completed' }],
    }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handlePhaseTransition(['3', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it('treats a skipped previous phase as valid', async () => {
    writeState(dir, baseState({
      phase: 2,
      phase_history: [{ phase: 2, phase_name: 'DESIGN', status: 'skipped' }],
    }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handlePhaseTransition(['3', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it('--force overrides the guard and warns', async () => {
    writeState(dir, baseState({ phase: 3, phase_history: [] }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const code = await handlePhaseTransition(['3', 'completed', '--dir', dir, '--skip-evidence', 'x', '--force']);
    const warned = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    outSpy.mockRestore();
    warnSpy.mockRestore();
    expect(code).toBe(0);
    expect(warned).toContain('overridden');
  });

  it('does not guard phase 1 (no predecessor)', async () => {
    writeState(dir, baseState({ phase: 1, phase_history: [] }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handlePhaseTransition(['1', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it('does not guard non-completed statuses', async () => {
    writeState(dir, baseState({ phase: 3, phase_history: [] }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handlePhaseTransition(['3', 'in_progress', '--dir', dir]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });
});

describe('#519 before/after echo', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p519echo-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints before→after for the top-level phase/status and the entry', async () => {
    // Phase 1 must be completed for the phase-2 completion to pass the
    // sequence guard (#519) — otherwise the echo is never reached.
    writeState(dir, baseState({
      phase: 2,
      status: 'in_progress',
      phase_history: [
        { phase: 1, name: 'PREP', status: 'completed' },
        { phase: 2, phase_name: 'DESIGN', status: 'in_progress' },
      ],
    }));
    const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handlePhaseTransition(['2', 'completed', '--dir', dir, '--skip-evidence', 'x']);
    const output = outSpy.mock.calls.map(c => c.join(' ')).join('\n');
    outSpy.mockRestore();
    expect(code).toBe(0);
    expect(output).toContain('before→after');
    expect(output).toContain('in_progress → completed');
  });
});

describe('#519 transition audit log + field normalization', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p519audit-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per transition with from/to', () => {
    writeState(dir, baseState({ phase: 2, phase_history: [] }));
    const manager = new SprintStateManager(dir);
    manager.transitionPhase(2, 'in_progress');
    manager.transitionPhase(2, 'completed');
    const auditFile = path.join(dir, '.sprint-state', 'transition-audit.jsonl');
    expect(fs.existsSync(auditFile)).toBe(true);
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.phase).toBe(2);
    expect(first.phase_name).toBe('DESIGN');
    expect(first.to_status).toBe('in_progress');
    expect(first.timestamp).toBeTruthy();
    const second = JSON.parse(lines[1]);
    expect(second.to_status).toBe('completed');
  });

  it('audit is best-effort: a write failure does not break the transition', () => {
    writeState(dir, baseState({ phase: 2, phase_history: [] }));
    const manager = new SprintStateManager(dir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Break the real appendFileSync so appendTransitionAudit's OWN try/catch is
    // exercised (mocking the method itself would bypass the production guard).
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => manager.transitionPhase(2, 'in_progress')).not.toThrow();
    const warned = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    appendSpy.mockRestore();
    warnSpy.mockRestore();
    expect(warned).toContain('transition audit write failed');
  });

  it('migrateState normalizes legacy `name` into `phase_name`', () => {
    // A legacy file (no _schema_version) whose phase 1 entry carries `name`
    // rather than `phase_name` — the exact shape #507 left behind.
    const legacy = baseState({
      _schema_version: undefined,
      phase_history: [{ phase: 1, name: 'PREP', status: 'completed' }],
    });
    const migrated = migrateState(legacy, dir);
    const entry = migrated.phase_history[0];
    // The canonical field is populated (via the legacy remap and/or the
    // name→phase_name normalization) and the legacy field is preserved.
    expect(entry.phase_name).toBeTruthy();
    expect(entry.name).toBe('PREP');
  });

  it('migrateState backfills `name` from `phase_name` (both directions)', () => {
    const legacy = baseState({
      _schema_version: undefined,
      phase_history: [{ phase: 2, phase_name: 'DESIGN', status: 'in_progress' }],
    });
    const migrated = migrateState(legacy, dir);
    const entry = migrated.phase_history[0];
    expect(entry.phase_name).toBeTruthy();
    // `name` is backfilled so a reader consulting either field agrees.
    expect(entry.name).toBe(entry.phase_name);
  });
});
