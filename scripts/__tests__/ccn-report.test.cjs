/**
 * @test REQ-CCNRPT-001
 * @intent ccn-report must invoke lizard once per file (batch mode inflates CCN spans) and bucket production vs test files
 * @covers AC-CCNRPT-001, AC-CCNRPT-002
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const reportPath = path.resolve(__dirname, '..', 'ccn-report.cjs');

function makeFixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-report-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'prod.js'),
    'function big(a,b,c,d,e){ if(a&&b||c){ if(d){ return e; } } return 0; }\n'
  );
  fs.writeFileSync(
    path.join(dir, 'src', '__tests__', 'prod.test.js'),
    "describe('x', () => { it('y', () => { expect(1).toBe(1); }); });\n"
  );
  return dir;
}

describe('ccn-report (per-file trustworthy measurement)', () => {
  it('exposes a measureFile helper that spawns lizard with exactly one file argument', async () => {
    const mod = require(reportPath);
    expect(typeof mod.measureFileArgs).toBe('function');
    const args = mod.measureFileArgs('some/file.ts');
    // Exactly one positional target, no directory batch.
    const targets = args.filter((a) => !a.startsWith('-'));
    expect(targets).toEqual([path.normalize('some/file.ts')]);
  });

  it('classifies files under __tests__ or *.test.* into the test bucket', async () => {
    const mod = require(reportPath);
    expect(mod.bucketFor('src/a.ts')).toBe('production');
    expect(mod.bucketFor('src/__tests__/a.test.ts')).toBe('test');
    expect(mod.bucketFor('scripts/x.test.cjs')).toBe('test');
  });

  it('produces a report over a real fixture tree without inflating spans', async () => {
    const dir = makeFixtureTree();
    try {
      const mod = require(reportPath);
      const report = await mod.run({ root: dir });
      const prod = report.functions.filter((f) => f.bucket === 'production');
      const tests = report.functions.filter((f) => f.bucket === 'test');
      expect(prod.length).toBeGreaterThan(0);
      expect(tests.length).toBeGreaterThan(0);
      // The whole-file describe callback of the tiny fixture must not be reported as a monster.
      for (const f of tests) expect(f.ccn).toBeLessThanOrEqual(10);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters duration_anomaly and null durations out of gate timing stats', () => {
    const mod = require(reportPath);
    const rows = [
      { duration_ms: 100 },
      { duration_ms: 300 },
      { duration_ms: 1792328460137, duration_anomaly: true },
      { duration_ms: null, reason: 'poisoned_start_ms' },
    ];
    const stats = mod.gateTimingStats(rows);
    expect(stats.count).toBe(2);
    expect(stats.p50).toBeGreaterThanOrEqual(100);
    expect(stats.p50).toBeLessThanOrEqual(300);
  });

  it('corrects lizard phantom CCN caused by generic-arrow brace confusion', async () => {
    // Reproduction of the real bug class: a Record<string, (…) => boolean>
    // field makes lizard's TS parser lose a brace; from there every function
    // span swallows its neighbours and CCN is charged across them (measured
    // in-tree: showHelp reported CCN 77 for a 20-line body with zero branches).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-phantom-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'handlers.ts'),
        [
          'type Args = Record<string, unknown>;',
          'const handlers: Record<string, (p: Args, n?: string) => boolean> = {',
          '  a: () => true,',
          '};',
          'export function tiny(): number {',
          '  return 1;',
          '}',
          'export function small(x: number): number {',
          '  if (x > 1) { return x + 1; }',
          '  return x;',
          '}',
          '',
        ].join('\n')
      );
      const mod = require(reportPath);
      const report = await mod.run({ root: dir });
      const prod = report.functions.filter((f) => f.bucket === 'production');
      expect(prod.length).toBeGreaterThan(0);
      // Whatever lizard claims, no honest recount may leave these two trivial
      // functions above the blocking threshold.
      for (const name of ['tiny', 'small']) {
        const row = prod.find((f) => f.name === name);
        if (row) expect(row.ccn).toBeLessThanOrEqual(10);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
