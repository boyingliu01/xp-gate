/**
 * Tests for phase-transition CLI command
 * @test REQ-338 Phase transition CLI + dashboard rendering
 * @intent Verify phase-transition command updates state and renders dashboard
 * @covers AC-338-01 (CLI transitions phase and writes state)
 * @covers AC-338-02 (--render flag outputs ASCII dashboard)
 * @covers AC-338-03 (invalid inputs return error exit code)
 * @covers AC-338-04 (--outputs flag records outputs in state)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  handlePhaseTransition,
  renderDashboard,
  PHASE_NAMES,
  validateEvidence,
  checkWalkthrough,
  checkBypassAudit,
} from '../phase-transition.js';

function git(command, cwd) {
  const env = { ...process.env };
  for (const name of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
    'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
  ]) {
    delete env[name];
  }
  return execSync(`git ${command}`, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function createRepository(dir, message) {
  git('init --quiet --template=', dir);
  git('config core.hooksPath /dev/null', dir);
  git('config user.email "test@test.com"', dir);
  git('config user.name "Test"', dir);
  fs.writeFileSync(path.join(dir, 'file.txt'), message);
  git('add file.txt', dir);
  git(`commit --quiet -m "${message}"`, dir);
  return git('rev-parse HEAD', dir);
}

describe('phase-transition', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-transition-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper: write phase 2 evidence (requirements-reviewed.json) so phase 2 completed passes */
  function writePhase2Evidence(dir) {
    const headCommit = fs.existsSync(path.join(dir, '.git'))
      ? git('rev-parse HEAD', dir)
      : createRepository(dir, 'phase 2 evidence');
    const requirementsStatement = 'Phase 2 evidence fixture';
    const timestamp = new Date().toISOString();
    const requirementsHash = crypto.createHash('sha256')
      .update(`${requirementsStatement}${timestamp.slice(0, 10)}`, 'utf8')
      .digest('hex');
    const outputsDir = path.join(dir, '.sprint-state', 'phase-outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    fs.writeFileSync(path.join(outputsDir, 'requirements-reviewed.json'), JSON.stringify({
      verdict: 'APPROVED',
      requirements_statement: requirementsStatement,
      context_file_used: null,
      requirements_hash: requirementsHash,
      head_commit: headCommit,
      consensus_ratio: 0.9,
      expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ],
      timestamp,
    }));
  }

  /** Helper: write phase 4 evidence (test-alignment-report.json) so phase 4 completed passes */
  function writePhase4Evidence(dir) {
    const headCommit = fs.existsSync(path.join(dir, '.git'))
      ? git('rev-parse HEAD', dir)
      : createRepository(dir, 'phase 4 evidence');
    const outputsDir = path.join(dir, '.sprint-state', 'phase-outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    fs.writeFileSync(path.join(outputsDir, 'test-alignment-report.json'), JSON.stringify({
      alignment_status: 'PASS',
      head_commit: headCommit,
      spec_hash: null,
      timestamp: new Date().toISOString(),
    }));
  }

  describe('handlePhaseTransition()', () => {
    it('returns 0 and shows help with --help', async () => {
      const code = await handlePhaseTransition(['--help']);
      expect(code).toBe(0);
    });

    it('returns 1 for missing arguments', async () => {
      const code = await handlePhaseTransition([]);
      expect(code).toBe(1);
    });

    it('returns 1 for invalid phase number', async () => {
      const code = await handlePhaseTransition(['7', 'completed']);
      expect(code).toBe(1);
    });

    it('returns 1 for invalid status', async () => {
      const code = await handlePhaseTransition(['1', 'invalid_status']);
      expect(code).toBe(1);
    });

    it('transitions phase and writes state file', async () => {
      const code = await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      expect(code).toBe(0);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.phase).toBe(1);
      expect(state.phase_history).toHaveLength(1);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[0].phase_name).toBe('PREP');
    });

    it('records outputs when --outputs flag is provided', async () => {
      writePhase2Evidence(tmpDir);
      const outputs = JSON.stringify({ spec: 'path/to/spec.yaml' });
      const code = await handlePhaseTransition(['2', 'completed', '--outputs', outputs, '--dir', tmpDir]);
      expect(code).toBe(0);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.outputs.spec).toBe('path/to/spec.yaml');
    });

    it('returns 1 for invalid --outputs JSON', async () => {
      const code = await handlePhaseTransition(['1', 'completed', '--outputs', 'not-json', '--dir', tmpDir]);
      expect(code).toBe(1);
    });

    it('transitions through multiple phases sequentially', async () => {
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['2', 'in_progress', '--dir', tmpDir]);
      writePhase2Evidence(tmpDir);
      await handlePhaseTransition(['2', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['3', 'in_progress', '--dir', tmpDir]);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      expect(state.phase).toBe(3);
      expect(state.phase_history).toHaveLength(3);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[1].status).toBe('completed');
      expect(state.phase_history[2].status).toBe('in_progress');
    });

    it('updates existing entry when same phase is transitioned again', async () => {
      await handlePhaseTransition(['1', 'in_progress', '--dir', tmpDir]);
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);

      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      // Should NOT have duplicate entries
      expect(state.phase_history).toHaveLength(1);
      expect(state.phase_history[0].status).toBe('completed');
      expect(state.phase_history[0].completed_at).toBeDefined();
    });
  });

  describe('renderDashboard()', () => {
    it('returns "No sprint state found" for null state', () => {
      const result = renderDashboard(null);
      expect(result).toBe('No sprint state found');
    });

    it('renders dashboard with all 6 phases', () => {
      const state = {
        id: 'sprint-test-123',
        task_description: 'Test feature',
        phase: 3,
        status: 'in_progress',
        started_at: '2026-07-21T10:00:00Z',
        phase_history: [
          { phase: 1, phase_name: 'PREP', status: 'completed', duration_seconds: 120 },
          { phase: 2, phase_name: 'DESIGN', status: 'completed', duration_seconds: 300 },
          { phase: 3, phase_name: 'BUILD', status: 'in_progress' },
        ],
        isolation: { branch: 'sprint/test-branch' },
        outputs: {},
      };

      const result = renderDashboard(state);

      expect(result).toContain('SPRINT PROGRESS');
      expect(result).toContain('sprint-test-123');
      expect(result).toContain('Test feature');
      expect(result).toContain('sprint/test-branch');
      expect(result).toContain('Phase 1/6');
      expect(result).toContain('Phase 6/6');
      expect(result).toContain('✅'); // completed phases
      expect(result).toContain('🔄'); // in_progress phase
      expect(result).toContain('⏳'); // pending phases
    });

    it('shows outputs section when outputs exist', () => {
      const state = {
        id: 'sprint-out',
        task_description: 'Feature',
        phase: 2,
        status: 'in_progress',
        started_at: '2026-07-21T10:00:00Z',
        phase_history: [],
        isolation: { branch: 'test' },
        outputs: { spec: 'design.yaml', pr: '#42' },
      };

      const result = renderDashboard(state);
      expect(result).toContain('输出物');
      expect(result).toContain('spec: design.yaml');
      expect(result).toContain('pr: #42');
    });

    it('handles minimal state gracefully', () => {
      const state = {
        id: 'sprint-min',
        phase: 1,
        status: 'in_progress',
        phase_history: [],
      };

      const result = renderDashboard(state);
      expect(result).toContain('SPRINT PROGRESS');
      expect(result).toContain('sprint-min');
    });
  });

  describe('repository-scoped Git checks', () => {
    it('checks walkthrough ancestry in projectDir when hook Git variables point elsewhere', () => {
      const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-outer-'));
      const targetCommit = createRepository(tmpDir, 'target commit');
      createRepository(outerDir, 'outer commit');
      fs.writeFileSync(path.join(tmpDir, '.code-walkthrough-result.json'), JSON.stringify({
        verdict: 'APPROVED',
        commit: targetCommit,
        expires: new Date(Date.now() + 3600000).toISOString(),
      }));
      const previousGitDir = process.env.GIT_DIR;
      const previousWorkTree = process.env.GIT_WORK_TREE;
      process.env.GIT_DIR = path.join(outerDir, '.git');
      process.env.GIT_WORK_TREE = outerDir;

      try {
        expect(checkWalkthrough(tmpDir).ok).toBe(true);
      } finally {
        if (previousGitDir === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = previousGitDir;
        if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
        else process.env.GIT_WORK_TREE = previousWorkTree;
        fs.rmSync(outerDir, { recursive: true, force: true });
      }
    });

    it('rejects a walkthrough bound to an older ancestor commit', () => {
      const reviewedCommit = createRepository(tmpDir, 'reviewed commit');
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'new unreviewed change');
      git('add file.txt', tmpDir);
      git('commit --quiet -m "unreviewed commit"', tmpDir);
      fs.writeFileSync(path.join(tmpDir, '.code-walkthrough-result.json'), JSON.stringify({
        verdict: 'APPROVED',
        commit: reviewedCommit,
        expires: new Date(Date.now() + 3600000).toISOString(),
      }));

      expect(checkWalkthrough(tmpDir).ok).toBe(false);
    });

    it('accepts a walkthrough bound to the current HEAD commit', () => {
      const reviewedCommit = createRepository(tmpDir, 'reviewed commit');
      fs.writeFileSync(path.join(tmpDir, '.code-walkthrough-result.json'), JSON.stringify({
        verdict: 'APPROVED',
        commit: reviewedCommit,
        expires: new Date(Date.now() + 3600000).toISOString(),
      }));

      expect(checkWalkthrough(tmpDir).ok).toBe(true);
    });

    it('checks bypass commits in projectDir when hook Git variables point elsewhere', () => {
      const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-outer-'));
      const targetCommit = createRepository(tmpDir, 'target bypass');
      createRepository(outerDir, 'outer commit');
      const auditDir = path.join(tmpDir, '.xp-gate');
      fs.mkdirSync(auditDir, { recursive: true });
      fs.writeFileSync(path.join(auditDir, 'bypass-audit.jsonl'), JSON.stringify({
        type: 'precommit_bypass',
        commit: targetCommit,
      }));
      const previousGitDir = process.env.GIT_DIR;
      const previousWorkTree = process.env.GIT_WORK_TREE;
      process.env.GIT_DIR = path.join(outerDir, '.git');
      process.env.GIT_WORK_TREE = outerDir;

      try {
        const result = checkBypassAudit(tmpDir);
        expect(result.ok).toBe(false);
        expect(result.bypassedCommits).toEqual([targetCommit]);
      } finally {
        if (previousGitDir === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = previousGitDir;
        if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
        else process.env.GIT_WORK_TREE = previousWorkTree;
        fs.rmSync(outerDir, { recursive: true, force: true });
      }
    });

    it('does not execute shell syntax from a walkthrough commit value', () => {
      const targetCommit = createRepository(tmpDir, 'target commit');
      const markerFile = path.join(tmpDir, 'walkthrough-injection-marker');
      fs.writeFileSync(path.join(tmpDir, '.code-walkthrough-result.json'), JSON.stringify({
        verdict: 'APPROVED',
        commit: `${targetCommit}; touch ${markerFile}; #`,
        expires: new Date(Date.now() + 3600000).toISOString(),
      }));

      const result = checkWalkthrough(tmpDir);

      expect(result.ok).toBe(false);
      expect(fs.existsSync(markerFile)).toBe(false);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['numeric', 123],
      ['empty', ''],
      ['malformed', 'not-a-commit'],
    ])('rejects a %s walkthrough commit', (_label, commit) => {
      createRepository(tmpDir, 'target commit');
      const walkthrough = {
        verdict: 'APPROVED',
        expires: new Date(Date.now() + 3600000).toISOString(),
      };
      if (commit !== undefined) walkthrough.commit = commit;
      fs.writeFileSync(
        path.join(tmpDir, '.code-walkthrough-result.json'),
        JSON.stringify(walkthrough)
      );

      expect(checkWalkthrough(tmpDir).ok).toBe(false);
    });

    it('does not execute shell syntax from a bypass-audit commit value', () => {
      const targetCommit = createRepository(tmpDir, 'target bypass');
      const markerFile = path.join(tmpDir, 'bypass-injection-marker');
      const auditDir = path.join(tmpDir, '.xp-gate');
      fs.mkdirSync(auditDir, { recursive: true });
      fs.writeFileSync(path.join(auditDir, 'bypass-audit.jsonl'), JSON.stringify({
        type: 'precommit_bypass',
        commit: `${targetCommit}; touch ${markerFile}; #`,
      }));

      const result = checkBypassAudit(tmpDir);

      expect(result.bypassedCommits).toEqual([]);
      expect(fs.existsSync(markerFile)).toBe(false);
    });
  });
  describe('Layer 1: Pre-transition gate check', () => {
    it('warns when previous phase not completed', async () => {
      // Set up: Phase 1 completed, then try Phase 3 in_progress (skipping Phase 2)
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['3', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Phase 2 (DESIGN) not recorded')
      );
      warnSpy.mockRestore();
    });

    it('does NOT warn when previous phase is completed', async () => {
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      writePhase2Evidence(tmpDir);
      await handlePhaseTransition(['2', 'completed', '--dir', tmpDir]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['3', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does NOT warn when previous phase is skipped', async () => {
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['2', 'skipped', '--dir', tmpDir]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['3', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('skips check when no sprint-state.json exists', async () => {
      // No state file — fresh project
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['2', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does NOT check for Phase 1 (no predecessor)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['1', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('handles phase_history with gaps correctly', async () => {
      // Set up: Phase 1 completed, Phase 3 completed (gap at Phase 2)
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      // Manually add Phase 3 without Phase 2
      const stateFile = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.phase_history.push({ phase: 3, phase_name: 'BUILD', status: 'completed' });
      state.phase = 3;
      fs.writeFileSync(stateFile, JSON.stringify(state));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await handlePhaseTransition(['4', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
      // Phase 3 is completed, so no warning for Phase 3→4 transition
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('Layer 1.5: Phase 6 auto-trigger', () => {
    it('outputs sprint-audit reminder on Phase 6 completed', async () => {
      // Set up state through Phase 5
      await handlePhaseTransition(['1', 'completed', '--dir', tmpDir]);
      writePhase2Evidence(tmpDir);
      await handlePhaseTransition(['2', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['3', 'completed', '--dir', tmpDir]);
      writePhase4Evidence(tmpDir);
      await handlePhaseTransition(['4', 'completed', '--dir', tmpDir]);
      await handlePhaseTransition(['5', 'completed', '--dir', tmpDir]);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await handlePhaseTransition(['6', 'completed', '--dir', tmpDir]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('sprint-audit')
      );
      logSpy.mockRestore();
    });
  });

  describe('PHASE_NAMES export', () => {
    it('exports PHASE_NAMES as shared constant', () => {
      expect(PHASE_NAMES).toBeDefined();
      expect(PHASE_NAMES[1]).toBe('PREP');
      expect(PHASE_NAMES[6]).toBe('CLOSE');
    });
  });

  describe('evidence validation', () => {
    /** Helper: create a sprint-state.json with given evidence_schema_version */
    function createSprintState(dir, evidenceSchemaVersion) {
      const stateDir = path.join(dir, '.sprint-state');
      fs.mkdirSync(stateDir, { recursive: true });
      const state = {
        _schema_version: 1,
        id: 'sprint-test-evidence',
        task_description: 'Evidence test',
        phase: 4,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        phase_history: [
          { phase: 1, phase_name: 'PREP', status: 'completed' },
          { phase: 2, phase_name: 'DESIGN', status: 'completed' },
          { phase: 3, phase_name: 'BUILD', status: 'completed' },
          { phase: 4, phase_name: 'VERIFY', status: 'in_progress' },
        ],
        isolation: { worktree_path: dir, branch: null },
        outputs: {},
        metrics: {},
      };
      if (evidenceSchemaVersion !== undefined) {
        state.evidence_schema_version = evidenceSchemaVersion;
      }
      fs.writeFileSync(path.join(stateDir, 'sprint-state.json'), JSON.stringify(state, null, 2));
    }

    /** Helper: write a test-alignment-report.json */
    function writeAlignmentReport(dir, report) {
      const outputsDir = path.join(dir, '.sprint-state', 'phase-outputs');
      fs.mkdirSync(outputsDir, { recursive: true });
      fs.writeFileSync(path.join(outputsDir, 'test-alignment-report.json'), JSON.stringify(report, null, 2));
    }

    function writeRequirementsReview(dir, report) {
      const outputsDir = path.join(dir, '.sprint-state', 'phase-outputs');
      fs.mkdirSync(outputsDir, { recursive: true });
      fs.writeFileSync(path.join(outputsDir, 'requirements-reviewed.json'), JSON.stringify(report, null, 2));
    }

    function validRequirementsReview(dir, overrides = {}) {
      const headCommit = fs.existsSync(path.join(dir, '.git'))
        ? git('rev-parse HEAD', dir)
        : createRepository(dir, 'reviewed requirements');
      const review = {
        verdict: 'APPROVED',
        requirements_statement: 'The release must preserve current quality gates.',
        context_file_used: null,
        timestamp: '2026-08-20T10:30:00.000Z',
        head_commit: headCommit,
        consensus_ratio: 0.9,
        expert_verdicts: [
          { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
          { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
          { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
        ],
        ...overrides,
      };
      const contextContent = review.context_file_used
        ? fs.readFileSync(path.join(dir, review.context_file_used), 'utf8')
        : '';
      return {
        ...review,
        requirements_hash: overrides.requirements_hash ?? crypto
          .createHash('sha256')
          .update(`${review.requirements_statement}${contextContent}${review.timestamp.slice(0, 10)}`, 'utf8')
          .digest('hex'),
      };
    }

    it('BLOCKs schema-v2 requirements evidence without head_commit', () => {
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, {
        verdict: 'APPROVED',
        requirements_hash: 'requirements-v1',
      });

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('head_commit'))).toBe(true);
    });

    it('BLOCKs schema-v2 requirements evidence bound to a stale HEAD', () => {
      const reviewedCommit = createRepository(tmpDir, 'reviewed requirements');
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'requirements changed');
      git('add file.txt', tmpDir);
      git('commit --quiet -m "changed requirements"', tmpDir);
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir, { head_commit: reviewedCommit }));

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('head_commit mismatch'))).toBe(true);
    });

    it('accepts schema-v2 requirements evidence bound to the current HEAD', () => {
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir));

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it.each([
      ['requirements_statement', { requirements_statement: undefined }],
      ['timestamp', { timestamp: undefined }],
      ['consensus_ratio', { consensus_ratio: undefined }],
      ['expert_verdicts', { expert_verdicts: undefined }],
      ['head_commit', { head_commit: undefined }],
      ['requirements_hash', { requirements_hash: undefined }],
    ])('BLOCKs schema-v2 requirements evidence missing %s', (field, overrides) => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      delete evidence[field];
      writeRequirementsReview(tmpDir, { ...evidence, ...overrides });

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes(field))).toBe(true);
    });

    it.each([
      ['non-hex hash', 'requirements-v1'],
      ['short hash', 'abc123'],
      ['valid-looking stale hash', '0'.repeat(64)],
    ])('BLOCKs schema-v2 requirements evidence with %s', (_label, requirementsHash) => {
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir, {
        requirements_hash: requirementsHash,
      }));

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('requirements_hash'))).toBe(true);
    });

    it('accepts an uppercase recomputable requirements hash', () => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      evidence.requirements_hash = evidence.requirements_hash.toUpperCase();
      writeRequirementsReview(tmpDir, evidence);

      expect(validateEvidence(2, tmpDir).ok).toBe(true);
    });

    it('BLOCKs when requirements_statement changes after hashing', () => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      evidence.requirements_statement = 'Changed after review.';
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('requirements_hash mismatch'))).toBe(true);
    });

    it('accepts a recomputable hash using a project-relative context file', () => {
      createSprintState(tmpDir, 2);
      fs.writeFileSync(path.join(tmpDir, 'CONTEXT.md'), 'bounded context\n', 'utf8');
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir, {
        context_file_used: 'CONTEXT.md',
      }));

      expect(validateEvidence(2, tmpDir).ok).toBe(true);
    });

    it('BLOCKs when context file content changes after hashing', () => {
      createSprintState(tmpDir, 2);
      fs.writeFileSync(path.join(tmpDir, 'CONTEXT.md'), 'original context\n', 'utf8');
      const evidence = validRequirementsReview(tmpDir, { context_file_used: 'CONTEXT.md' });
      fs.writeFileSync(path.join(tmpDir, 'CONTEXT.md'), 'changed context\n', 'utf8');
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('requirements_hash mismatch'))).toBe(true);
    });

    it.each([
      ['missing path', 'missing/CONTEXT.md'],
      ['absolute path', '/tmp/CONTEXT.md'],
      ['traversal path', '../CONTEXT.md'],
    ])('BLOCKs schema-v2 requirements evidence with %s context', (_label, contextFileUsed) => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      evidence.context_file_used = contextFileUsed;
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('context_file_used'))).toBe(true);
    });

    it('BLOCKs a context symlink that resolves outside the project root', () => {
      createSprintState(tmpDir, 2);
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-context-'));
      const outsideFile = path.join(outsideDir, 'CONTEXT.md');
      fs.writeFileSync(outsideFile, 'outside context\n', 'utf8');
      fs.symlinkSync(outsideFile, path.join(tmpDir, 'CONTEXT.md'));
      const evidence = validRequirementsReview(tmpDir, { context_file_used: 'CONTEXT.md' });
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('context_file_used'))).toBe(true);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it.each([
      ['invalid timestamp', 'not-a-timestamp'],
      ['invalid calendar date', '2026-02-30T10:30:00.000Z'],
    ])('BLOCKs schema-v2 requirements evidence with %s', (_label, timestamp) => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      evidence.timestamp = timestamp;
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('timestamp'))).toBe(true);
    });

    it.each([
      ['missing expert_verdicts', { expert_verdicts: undefined }, 'expert_verdicts'],
      ['too few expert_verdicts', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
      ] }, 'exactly 3'],
      ['too many expert_verdicts', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
        { role: 'extra', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-d' },
      ] }, 'exactly 3'],
      ['duplicate role', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'roles'],
      ['missing role', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'roles'],
      ['non-approved expert verdict', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'REQUEST_CHANGES', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'APPROVED'],
      ['wrong result_type', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'summary', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'result_type'],
      ['blank requested_model', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: '   ' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-b' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'requested_model'],
      ['duplicate trimmed requested_model', { expert_verdicts: [
        { role: 'architecture', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-a' },
        { role: 'technical', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: ' model-a ' },
        { role: 'feasibility', verdict: 'APPROVED', result_type: 'delphi_expert_result', requested_model: 'model-c' },
      ] }, 'distinct'],
    ])('BLOCKs schema-v2 requirements evidence with %s', (_label, overrides, expectedError) => {
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir, overrides));

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes(expectedError))).toBe(true);
    });

    it('does not include arbitrary expert payloads in validation errors', () => {
      createSprintState(tmpDir, 2);
      writeRequirementsReview(tmpDir, validRequirementsReview(tmpDir, {
        verdict: 'REQUEST_CHANGES',
        expert_verdicts: [{ private_payload: 'do-not-leak' }],
      }));

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).not.toContain('do-not-leak');
    });

    it.each([
      ['missing', undefined],
      ['non-number', '0.95'],
      ['below threshold', 0.89],
      ['above one', 1.01],
      ['non-finite', Number.POSITIVE_INFINITY],
    ])('BLOCKs schema-v2 requirements evidence with %s consensus_ratio', (_label, consensusRatio) => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir, { consensus_ratio: consensusRatio });
      if (consensusRatio === undefined) delete evidence.consensus_ratio;
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('consensus_ratio'))).toBe(true);
    });

    it('BLOCKs schema-v2 requirements evidence when Git HEAD cannot be resolved', () => {
      createSprintState(tmpDir, 2);
      const evidence = validRequirementsReview(tmpDir);
      fs.rmSync(path.join(tmpDir, '.git'), { recursive: true, force: true });
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('resolve current Git HEAD'))).toBe(true);
    });

    it.each([
      ['invalid expert evidence', { expert_verdicts: [] }, 'expert_verdicts'],
      ['unresolved HEAD', null, 'resolve current Git HEAD'],
      ['stale HEAD', { head_commit: 'deadbeef00000000000000000000000000000000' }, 'head_commit mismatch'],
      ['stale requirements hash', { requirements_hash: '0'.repeat(64) }, 'requirements_hash'],
      ['invalid timestamp', { timestamp: 'not-a-timestamp' }, 'timestamp'],
      ['unsafe context path', { context_file_used: '../CONTEXT.md' }, 'context_file_used'],
    ])('WARNs but accepts legacy requirements evidence with %s', (_label, overrides, expectedWarning) => {
      const evidence = validRequirementsReview(tmpDir);
      if (overrides) Object.assign(evidence, overrides);
      if (overrides === null) fs.rmSync(path.join(tmpDir, '.git'), { recursive: true, force: true });
      createSprintState(tmpDir);
      writeRequirementsReview(tmpDir, evidence);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(true);
      expect(result.warnings.some(warning => warning.includes(expectedWarning))).toBe(true);
    });

    it.each([
      ['missing', undefined],
      ['stale', 'deadbeef00000000000000000000000000000000'],
    ])('WARNs but accepts legacy requirements evidence with %s head_commit', (_label, headCommit) => {
      createRepository(tmpDir, 'reviewed requirements');
      createSprintState(tmpDir);
      const report = {
        verdict: 'APPROVED',
        requirements_hash: 'requirements-v1',
      };
      if (headCommit !== undefined) report.head_commit = headCommit;
      writeRequirementsReview(tmpDir, report);

      const result = validateEvidence(2, tmpDir);

      expect(result.ok).toBe(true);
      expect(result.warnings.some(warning => warning.includes('head_commit'))).toBe(true);
    });

    it('(a) BLOCKs when evidence file is missing for new sprint (evidence_schema_version >= 2)', () => {
      createSprintState(tmpDir, 2);
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('test-alignment-report.json');
    });

    it('(b) BLOCKs when alignment_status is FAIL', () => {
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'FAIL',
        head_commit: 'unknown',
        spec_hash: null,
        timestamp: new Date().toISOString(),
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('alignment') || e.includes('PASS'))).toBe(true);
    });

    it('(c) BLOCKs when head_commit is stale (does not match current HEAD)', () => {
      createRepository(tmpDir, 'aligned tests');
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: 'deadbeef00000000000000000000000000000000',
        spec_hash: null,
        timestamp: new Date().toISOString(),
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('head_commit'))).toBe(true);
    });

    it('BLOCKs schema-v2 phase 4 evidence when Git HEAD cannot be resolved', () => {
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: 'unknown',
        spec_hash: null,
      });

      const result = validateEvidence(4, tmpDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('resolve current Git HEAD'))).toBe(true);
    });

    it('WARNs but accepts legacy phase 4 evidence when Git HEAD cannot be resolved', () => {
      createSprintState(tmpDir);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: 'unknown',
        spec_hash: null,
      });

      const result = validateEvidence(4, tmpDir);

      expect(result.ok).toBe(true);
      expect(result.warnings.some(warning => warning.includes('resolve current Git HEAD'))).toBe(true);
    });

    it('(d) BLOCKs when evidence file is malformed JSON (treated as missing)', () => {
      createSprintState(tmpDir, 2);
      const outputsDir = path.join(tmpDir, '.sprint-state', 'phase-outputs');
      fs.mkdirSync(outputsDir, { recursive: true });
      fs.writeFileSync(path.join(outputsDir, 'test-alignment-report.json'), '{invalid json!!!');
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('malformed'))).toBe(true);
    });

    it('(e) WARNs but does NOT block for legacy sprint (no evidence_schema_version)', () => {
      createSprintState(tmpDir); // no evidence_schema_version
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('evidence_schema_version');
    });

    it('(f) allows bypass with --skip-evidence and --reason via handlePhaseTransition', async () => {
      createSprintState(tmpDir, 2);
      // No evidence file — would normally BLOCK
      const code = await handlePhaseTransition([
        '4', 'completed', '--dir', tmpDir,
        '--skip-evidence', 'Emergency hotfix',
      ]);
      expect(code).toBe(0);

      // Verify audit entry was written
      const auditFile = path.join(tmpDir, '.xp-gate', 'audit.jsonl');
      expect(fs.existsSync(auditFile)).toBe(true);
      const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.event).toBe('evidence_skipped');
      expect(lastEntry.phase).toBe(4);
      expect(lastEntry.reason).toBe('Emergency hotfix');
      expect(lastEntry.commit_hash).toBe('unknown');
    });

    it('(g) rejects --skip-evidence without --reason', async () => {
      createSprintState(tmpDir, 2);
      const code = await handlePhaseTransition([
        '4', 'completed', '--dir', tmpDir,
        '--skip-evidence',
      ]);
      expect(code).toBe(1);
    });

    it('returns ok for phases without evidence requirements (phase 1, 3, 5, 6)', () => {
      createSprintState(tmpDir, 2);
      for (const phase of [1, 3, 5, 6]) {
        const result = validateEvidence(phase, tmpDir);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('accepts valid phase 4 evidence with head_commit matching current HEAD', () => {
      const currentHead = createRepository(tmpDir, 'aligned tests');
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: currentHead,
        spec_hash: null,
        timestamp: new Date().toISOString(),
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates spec_hash when specification.yaml exists', () => {
      const currentHead = createRepository(tmpDir, 'aligned specification');
      createSprintState(tmpDir, 2);
      // Create a specification.yaml
      const specContent = 'requirements:\n  - id: REQ-001\n';
      fs.writeFileSync(path.join(tmpDir, 'specification.yaml'), specContent);

      // Compute expected hash
      const crypto = require('crypto');
      const expectedHash = crypto.createHash('sha256').update(specContent, 'utf8').digest('hex');

      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: currentHead,
        spec_hash: expectedHash,
        timestamp: new Date().toISOString(),
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(true);
    });

    it('BLOCKs when spec_hash does not match specification.yaml', () => {
      const currentHead = createRepository(tmpDir, 'stale specification');
      createSprintState(tmpDir, 2);
      fs.writeFileSync(path.join(tmpDir, 'specification.yaml'), 'requirements:\n  - id: REQ-001\n');
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: currentHead,
        spec_hash: 'wronghash000000000000000000000000000000000000000000000000000000',
        timestamp: new Date().toISOString(),
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('spec_hash'))).toBe(true);
    });

    it('BLOCKs when required fields are missing from evidence', () => {
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        // missing head_commit and spec_hash
      });
      const result = validateEvidence(4, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('head_commit'))).toBe(true);
    });

    it('does NOT validate evidence for non-completed statuses', async () => {
      createSprintState(tmpDir, 2);
      // in_progress should not trigger evidence validation
      const code = await handlePhaseTransition(['4', 'in_progress', '--dir', tmpDir]);
      expect(code).toBe(0);
    });

    it('handlePhaseTransition BLOCKs phase 4 completed without evidence for new sprint', async () => {
      createSprintState(tmpDir, 2);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await handlePhaseTransition(['4', 'completed', '--dir', tmpDir]);
      expect(code).toBe(1);
      errorSpy.mockRestore();
    });

    it('handlePhaseTransition allows phase 4 completed with valid evidence', async () => {
      const currentHead = createRepository(tmpDir, 'aligned tests');
      createSprintState(tmpDir, 2);
      writeAlignmentReport(tmpDir, {
        alignment_status: 'PASS',
        head_commit: currentHead,
        spec_hash: null,
        timestamp: new Date().toISOString(),
      });
      const code = await handlePhaseTransition(['4', 'completed', '--dir', tmpDir]);
      expect(code).toBe(0);
    });
  });
});
