/**
 * Tests for sprint-audit CLI command (Layer 2)
 * @test REQ-338 Sprint audit — final completeness check
 * @intent Verify sprint-audit correctly checks phase coverage, artifacts, consistency
 * @covers AC-AUDIT-01 (SKIP when no sprint-state.json)
 * @covers AC-AUDIT-02 (PASS when 6/6 completed)
 * @covers AC-AUDIT-03 (PASS_WITH_WARNINGS when 4-5/6 completed)
 * @covers AC-AUDIT-04 (FAIL when <4/6 completed)
 * @covers AC-AUDIT-05 (FAIL on state inconsistency)
 * @covers AC-AUDIT-06 (--json flag outputs JSON)
 * @covers AC-AUDIT-07 (report persisted to audit-report.json)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSprintAudit } from '../sprint-audit.js';

describe('sprint-audit', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-audit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeState(state) {
    const stateDir = path.join(tmpDir, '.sprint-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'sprint-state.json'), JSON.stringify(state));
  }

  function makeState(overrides = {}) {
    return {
      _schema_version: 1,
      id: 'sprint-test-audit',
      task_description: 'Test audit feature',
      phase: 6,
      status: 'completed',
      started_at: '2026-07-22T10:00:00Z',
      phase_history: [],
      isolation: { branch: 'sprint/test-audit', worktree_path: null },
      outputs: {},
      ...overrides,
    };
  }

  function makePhaseHistory(completedPhases) {
    const phaseNames = ['PREP', 'DESIGN', 'BUILD', 'VERIFY', 'SHIP', 'CLOSE'];
    return completedPhases.map((p, i) => ({
      phase: p,
      phase_name: phaseNames[p - 1],
      status: 'completed',
      started_at: `2026-07-22T10:${String(i).padStart(2, '0')}:00Z`,
      completed_at: `2026-07-22T10:${String(i).padStart(2, '0')}:30Z`,
      duration_seconds: 30,
    }));
  }

  describe('handleSprintAudit()', () => {
    it('returns 0 and shows help with --help', async () => {
      const code = await handleSprintAudit(['--help']);
      expect(code).toBe(0);
    });

    it('returns SKIP (exit 0) when no sprint-state.json exists', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No sprint-state.json'));
      logSpy.mockRestore();
    });

    it('returns PASS when 6/6 phases completed', async () => {
      writeState(makeState({ phase_history: makePhaseHistory([1, 2, 3, 4, 5, 6]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(0);
      // Check output contains PASS
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('PASS');
      expect(output).toContain('6/6');
      logSpy.mockRestore();
    });

    it('returns PASS_WITH_WARNINGS when 5/6 completed', async () => {
      writeState(makeState({ phase: 5, phase_history: makePhaseHistory([1, 2, 3, 4, 5]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(0);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('PASS_WITH_WARNINGS');
      logSpy.mockRestore();
    });

    it('returns PASS_WITH_WARNINGS when 4/6 completed', async () => {
      writeState(makeState({ phase: 4, phase_history: makePhaseHistory([1, 2, 3, 4]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(0);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('PASS_WITH_WARNINGS');
      logSpy.mockRestore();
    });

    it('returns FAIL when <4/6 completed', async () => {
      writeState(makeState({ phase: 3, phase_history: makePhaseHistory([1, 2, 3]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(1);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('FAIL');
      logSpy.mockRestore();
    });

    it('returns FAIL on state inconsistency (phase vs phase_history)', async () => {
      const history = makePhaseHistory([1, 2, 3, 4, 5, 6]);
      writeState(makeState({ phase: 3, phase_history: history })); // phase=3 but last entry is 6

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(1);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('State inconsistency');
      logSpy.mockRestore();
    });

    it('outputs JSON when --json flag is set', async () => {
      writeState(makeState({ phase_history: makePhaseHistory([1, 2, 3, 4, 5, 6]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir, '--json']);
      expect(code).toBe(0);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.verdict).toBe('PASS');
      expect(result.coverage.completed).toBe(6);
      logSpy.mockRestore();
    });

    it('counts skipped phases as completed in coverage', async () => {
      const history = makePhaseHistory([1, 2, 3, 4, 5]);
      history.push({
        phase: 6, phase_name: 'CLOSE', status: 'skipped',
        started_at: '2026-07-22T10:05:00Z', completed_at: '2026-07-22T10:05:00Z', duration_seconds: 0,
      });
      writeState(makeState({ phase: 6, phase_history: history }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir, '--json']);
      expect(code).toBe(0);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.coverage.completed).toBe(6);
      expect(result.verdict).toBe('PASS');
      logSpy.mockRestore();
    });

    it('warns about missing summary files for completed phases', async () => {
      writeState(makeState({ phase_history: makePhaseHistory([1, 2, 3, 4, 5, 6]) }));
      // No phase-outputs directory → all summaries missing

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir, '--json']);
      expect(code).toBe(0);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('summary missing'))).toBe(true);
      logSpy.mockRestore();
    });

    it('persists audit report to audit-report.json', async () => {
      writeState(makeState({ phase_history: makePhaseHistory([1, 2, 3, 4, 5, 6]) }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleSprintAudit(['--dir', tmpDir]);
      logSpy.mockRestore();

      const reportPath = path.join(tmpDir, '.sprint-state', 'audit-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(report.verdict).toBe('PASS');
      expect(report.sprint_id).toBe('sprint-test-audit');
    });

    it('handles corrupted sprint-state.json gracefully', async () => {
      const stateDir = path.join(tmpDir, '.sprint-state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'sprint-state.json'), 'not-valid-json');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await handleSprintAudit(['--dir', tmpDir]);
      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
      errSpy.mockRestore();
    });
  });
});
