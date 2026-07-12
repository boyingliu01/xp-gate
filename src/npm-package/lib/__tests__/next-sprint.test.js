const fs = require('fs');
const path = require('path');
const os = require('os');

describe('next-sprint', () => {
  let tmpDir;
  let consoleSpy;
  let processExitSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-sprint-test-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    // Clear require cache to ensure fresh module for each test
    delete require.cache[require.resolve('../next-sprint')];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createState(overrides = {}) {
    const stateDir = path.join(tmpDir, '.sprint-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const state = {
      id: 'sprint-2026-06-30-01',
      task_description: 'Test Sprint',
      phase: 4,
      status: 'completed',
      started_at: new Date().toISOString(),
      phase_history: [
        {
          phase: 2,
          phase_name: 'BUILD',
          status: 'completed',
          reqs: {
            'REQ-001': { name: 'Implement login', status: 'completed' },
            'REQ-002': { name: 'Implement logout', status: 'completed' },
          },
        },
      ],
      ...overrides,
    };
    fs.writeFileSync(path.join(stateDir, 'sprint-state.json'), JSON.stringify(state));
    return state;
  }

  function mockGhCli(issues) {
    const { execSync } = require('child_process');
    vi.spyOn(require('child_process'), 'execSync').mockImplementation((cmd) => {
      if (cmd.includes('gh issue list')) {
        return JSON.stringify(issues);
      }
      return '';
    });
  }

  describe('readSprintState', () => {
    it('returns null when no sprint state exists', () => {
      const { readSprintState } = require('../next-sprint');
      const result = readSprintState(tmpDir);
      expect(result).toBeNull();
    });

    it('returns parsed state when sprint state exists', () => {
      const state = createState();
      const { readSprintState } = require('../next-sprint');
      const result = readSprintState(tmpDir);
      expect(result).toBeDefined();
      expect(result.id).toBe('sprint-2026-06-30-01');
    });
  });

  describe('getCurrentSprintReqs', () => {
    it('extracts requirements from sprint state', () => {
      createState();
      const { readSprintState, getCurrentSprintReqs } = require('../next-sprint');
      const state = readSprintState(tmpDir);
      const reqs = getCurrentSprintReqs(state);
      expect(reqs).toHaveLength(2);
      expect(reqs[0].name).toBe('Implement login');
      expect(reqs[1].name).toBe('Implement logout');
    });

    it('returns empty array when no phase history', () => {
      const { getCurrentSprintReqs } = require('../next-sprint');
      const reqs = getCurrentSprintReqs({ phase_history: [] });
      expect(reqs).toEqual([]);
    });
  });

  describe('filterRemainingIssues', () => {
    it('filters out issues already in sprint', () => {
      const issues = [
        { number: 1, title: 'Implement login', labels: [], createdAt: '2026-06-30T00:00:00Z' },
        { number: 2, title: 'Implement logout', labels: [], createdAt: '2026-06-30T00:00:00Z' },
        { number: 3, title: 'Implement signup', labels: [], createdAt: '2026-06-30T00:00:00Z' },
      ];
      const sprintReqs = [{ name: 'Implement login' }, { name: 'Implement logout' }];
      const { filterRemainingIssues } = require('../next-sprint');
      const result = filterRemainingIssues(issues, sprintReqs);
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(3);
    });

    it('returns all issues when no sprint reqs', () => {
      const issues = [
        { number: 1, title: 'Implement login', labels: [], createdAt: '2026-06-30T00:00:00Z' },
        { number: 2, title: 'Implement logout', labels: [], createdAt: '2026-06-30T00:00:00Z' },
      ];
      const { filterRemainingIssues } = require('../next-sprint');
      const result = filterRemainingIssues(issues, []);
      expect(result).toHaveLength(2);
    });
  });

  describe('formatIssuesTable', () => {
    it('formats issues as table', () => {
      const issues = [
        { number: 1, title: 'Implement login', labels: [{ name: 'feature' }], createdAt: '2026-06-30T00:00:00Z' },
        { number: 2, title: 'Implement logout', labels: [{ name: 'bug' }], createdAt: '2026-06-30T00:00:00Z' },
      ];
      const { formatIssuesTable } = require('../next-sprint');
      const result = formatIssuesTable(issues);
      expect(result).toContain('Remaining Open Issues');
      expect(result).toContain('Implement login');
      expect(result).toContain('feature');
    });

    it('handles empty issues', () => {
      const { formatIssuesTable } = require('../next-sprint');
      const result = formatIssuesTable([]);
      expect(result).toBe('No remaining issues found.');
    });
  });

  describe('generateSprintPlan', () => {
    it('generates sprint plan for remaining issues', () => {
      const issues = [
        { number: 1, title: 'Implement login', labels: [], createdAt: '2026-06-30T00:00:00Z' },
        { number: 2, title: 'Implement logout', labels: [], createdAt: '2026-06-30T00:00:00Z' },
      ];
      const { generateSprintPlan } = require('../next-sprint');
      const result = generateSprintPlan(issues);
      expect(result).toContain('Suggested Next Sprint Plan');
      expect(result).toContain('#1');
      expect(result).toContain('sprint-flow');
    });

    it('returns null when no issues', () => {
      const { generateSprintPlan } = require('../next-sprint');
      const result = generateSprintPlan([]);
      expect(result).toBeNull();
    });
  });

  describe('handleNextSprint', () => {
    it('outputs remaining issues in table format', async () => {
      createState();
      const { execSync } = require('child_process');
      vi.spyOn(require('child_process'), 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('gh issue list')) {
          return JSON.stringify([
            { number: 1, title: 'Implement login', labels: [{ name: 'feature' }], createdAt: '2026-06-30T00:00:00Z' },
            { number: 2, title: 'Implement logout', labels: [{ name: 'bug' }], createdAt: '2026-06-30T00:00:00Z' },
            { number: 3, title: 'Implement signup', labels: [{ name: 'enhancement' }], createdAt: '2026-06-30T00:00:00Z' },
          ]);
        }
        return '';
      });
      delete require.cache[require.resolve('../next-sprint')];
      const { handleNextSprint } = require('../next-sprint');
      const result = await handleNextSprint(['--dir', tmpDir]);
      expect(result).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Remaining Open Issues');
      expect(output).toContain('Implement signup');
    });

    it('outputs JSON when --json flag', async () => {
      createState();
      vi.spyOn(require('child_process'), 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('gh issue list')) {
          return JSON.stringify([
            { number: 1, title: 'Implement login', labels: [], createdAt: '2026-06-30T00:00:00Z' },
          ]);
        }
        return '';
      });
      delete require.cache[require.resolve('../next-sprint')];
      const { handleNextSprint } = require('../next-sprint');
      const result = await handleNextSprint(['--json', '--dir', tmpDir]);
      expect(result).toBe(0);
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('current_sprint');
      expect(parsed).toHaveProperty('remaining_issues');
    });

    it('outputs plan when --plan flag', async () => {
      createState();
      vi.spyOn(require('child_process'), 'execSync').mockImplementation((cmd) => {
        if (cmd.includes('gh issue list')) {
          return JSON.stringify([
            { number: 5, title: 'Implement password reset', labels: [], createdAt: '2026-06-30T00:00:00Z' },
          ]);
        }
        return '';
      });
      delete require.cache[require.resolve('../next-sprint')];
      const { handleNextSprint } = require('../next-sprint');
      const result = await handleNextSprint(['--plan', '--dir', tmpDir]);
      expect(result).toBe(0);
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Suggested Next Sprint Plan');
    });

    it('returns 1 when gh CLI not available', async () => {
      vi.spyOn(require('child_process'), 'execSync').mockImplementation(() => {
        throw new Error('gh: command not found');
      });
      delete require.cache[require.resolve('../next-sprint')];
      const { handleNextSprint } = require('../next-sprint');
      const result = await handleNextSprint(['--dir', tmpDir]);
      expect(result).toBe(1);
    });
  });
});
