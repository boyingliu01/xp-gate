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
