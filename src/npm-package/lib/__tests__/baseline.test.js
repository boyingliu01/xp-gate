/**
 * @test REQ-152 Baseline CLI handler
 * @intent Verify baseline create/show/reset/diff commands
 * @covers AC-152
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { handleBaseline, showBaseline } = require('../baseline.js');

describe('baseline.js - CLI handler', () => {
  let tmpDir;
  const originalCwd = process.cwd;

  afterAll(() => {
    process.cwd = originalCwd;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-cli-test-'));
    process.cwd = () => tmpDir;
  });

  describe('handleBaseline - help', () => {
    it('prints usage when no subcommand given', async () => {
      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      const code = await handleBaseline([]);
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('Usage'))).toBe(true);

      console.log = origLog;
    });

    it('prints usage for --help', async () => {
      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      const code = await handleBaseline(['--help']);
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('Usage'))).toBe(true);

      console.log = origLog;
    });
  });

  describe('handleBaseline - unknown subcommand', () => {
    it('returns error for unknown subcommand', async () => {
      const logs = [];
      const errs = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args) => logs.push(args.join(' '));
      console.error = (...args) => errs.push(args.join(' '));

      const code = await handleBaseline(['unknown-cmd']);
      expect(code).toBe(1);
      expect(errs.some(l => l.includes('Unknown baseline subcommand'))).toBe(true);

      console.log = origLog;
      console.error = origErr;
    });
  });

  // === TECH-005/006/007: Extracted helper unit tests (CCN reduction) ===

  describe('countBaselineByTool', () => {
    it('counts files by tool type from baseline data', () => {
      const doc = require('../baseline.js');
      const data = {
        'a.ts': { eslint: { warnings: 3, errors: 0 }, totalWarnings: 3, lastAnalyzed: '2026-01-01' },
        'b.py': { ruff: { warnings: 2, errors: 0 }, totalWarnings: 2, lastAnalyzed: '2026-01-01' },
        'c.go': { golangci: { warnings: 1, errors: 1 }, totalWarnings: 1, lastAnalyzed: '2026-01-01' },
        'd.sh': { shellcheck: { warnings: 4, errors: 0 }, totalWarnings: 4, lastAnalyzed: '2026-01-01' },
      };
      const result = doc.countBaselineByTool(data);
      expect(result.eslintCount).toBe(1);
      expect(result.ruffCount).toBe(1);
      expect(result.golangciCount).toBe(1);
      expect(result.shellcheckCount).toBe(1);
      expect(result.totalFiles).toBe(4);
      expect(result.totalWarnings).toBe(10);
    });

    it('returns zeroes for empty baseline', () => {
      const doc = require('../baseline.js');
      const result = doc.countBaselineByTool({});
      expect(result.eslintCount).toBe(0);
      expect(result.ruffCount).toBe(0);
      expect(result.totalFiles).toBe(0);
      expect(result.totalWarnings).toBe(0);
    });

    it('handles mixed entries with some missing tool fields', () => {
      const doc = require('../baseline.js');
      const data = {
        'a.ts': { eslint: { warnings: 3, errors: 0 }, totalWarnings: 3, lastAnalyzed: '2026-01-01' },
        'b.ts': { totalWarnings: 0, lastAnalyzed: '2026-01-01' },
      };
      const result = doc.countBaselineByTool(data);
      expect(result.eslintCount).toBe(1);
      expect(result.totalFiles).toBe(2);
      expect(result.totalWarnings).toBe(3);
    });
  });

  describe('compareBaselines', () => {
    it('detects added, removed, increased, and decreased files', () => {
      const doc = require('../baseline.js');
      const oldB = {
        'stable.ts': { totalWarnings: 3 },
        'increased.ts': { totalWarnings: 2 },
        'decreased.ts': { totalWarnings: 5 },
        'removed.ts': { totalWarnings: 1 },
      };
      const newB = {
        'stable.ts': { totalWarnings: 3 },
        'increased.ts': { totalWarnings: 5 },
        'decreased.ts': { totalWarnings: 1 },
        'added.ts': { totalWarnings: 4 },
      };
      const result = doc.compareBaselines(oldB, newB);
      expect(result.totalWarningsDelta).toBe(2);
      expect(result.increased.length).toBe(1);
      expect(result.increased[0]).toContain('increased.ts');
      expect(result.decreased.length).toBe(1);
      expect(result.decreased[0]).toContain('decreased.ts');
      expect(result.added.length).toBe(1);
      expect(result.added[0]).toContain('added.ts');
      expect(result.removed.length).toBe(1);
      expect(result.removed[0]).toContain('removed.ts');
    });

    it('returns empty arrays when baselines are identical', () => {
      const doc = require('../baseline.js');
      const baseline = { 'file.ts': { totalWarnings: 3 } };
      const result = doc.compareBaselines(baseline, baseline);
      expect(result.totalWarningsDelta).toBe(0);
      expect(result.increased).toEqual([]);
      expect(result.decreased).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it('handles empty old or new baseline', () => {
      const doc = require('../baseline.js');
      const baseline = { 'file.ts': { totalWarnings: 3 } };
      const result = doc.compareBaselines({}, baseline);
      expect(result.added.length).toBe(1);
      expect(result.totalWarningsDelta).toBe(3);
    });
  });

  describe('showBaseline - no baseline file', () => {
    it('shows message when no baseline exists', () => {
      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      const code = showBaseline();
      expect(code).toBe(1);
      expect(logs.some(l => l.includes('No baseline'))).toBe(true);

      console.log = origLog;
    });
  });

  describe('showBaseline - with baseline file', () => {
    it('shows summary when baseline exists', () => {
      const baselinePath = path.join(tmpDir, '.xp-gate', 'lint-baseline.json');
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, JSON.stringify({
        'src/app.ts': {
          eslint: { warnings: 3, errors: 1 },
          totalWarnings: 3,
          lastAnalyzed: '2026-06-01T12:00:00.000Z',
        },
      }));

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      const code = showBaseline();
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('3'))).toBe(true);
      expect(logs.some(l => l.includes('ESLint'))).toBe(true);

      console.log = origLog;
    });

    it('shows empty message for baseline with no entries', () => {
      const baselinePath = path.join(tmpDir, '.xp-gate', 'lint-baseline.json');
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, '{}');

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      const code = showBaseline();
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('empty'))).toBe(true);

      console.log = origLog;
    });
  });
});
