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

  /**
   * @test REQ-544
   * @intent lizard reports a rule object's CCN row starting at the `check:`
   *         callback (line 9), several lines BELOW the `export const X: Rule =`
   *         binding the row is named after. The verifier only searched downward
   *         from the reported line, failed to locate the body, and returned
   *         lizard's span-inflated number unchallenged — measured in-tree:
   *         srpRule 31 (real 14), ocpRule 31 (real 11), dipRule 27 (real 11).
   * @covers AC-544-01, AC-544-02
   */
  it('locates a rule body whose own declaration line is ABOVE lizard\'s reported start', () => {
    const mod = require(reportPath);
    const lines = [
      'export const rule: Rule = {',
      "  id: 'x',",
      '  check: (file: string, a: A): V[] => {',
      '    const out: V[] = [];',
      '    if (!out) return out;',
      '    for (const r of a) { if (r) out.push(r); }',
      '    return out;',
      '  },',
      '};',
      '',
    ];
    // lizard-style row: named `rule`, starting at the callback line (3).
    const res = mod.verifyRowCcn({ srcLines: lines, name: 'rule', ccn: 40, lineNo: 3, endNo: 9 });
    expect(res.corrected).toBe(true);
    expect(res.ccn).toBeLessThan(40);
  });

  it('never reports a correction it cannot justify (unlocatable rows stay flagged)', () => {
    const mod = require(reportPath);
    const res = mod.verifyRowCcn({
      srcLines: ['const other = 1;', 'const more = 2;'],
      name: 'nowhere',
      ccn: 30,
      lineNo: 1,
      endNo: 2,
    });
    expect(res.corrected).toBe(false);
    expect(res.unlocatable).toBe(true);
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent verifyRowCcn is the only thing standing between a lizard parser
   *         defect and a phantom CCN in the ratchet. If it silently trusts a
   *         malformed span, the fallback is indistinguishable from no fallback
   *         at all — the exact failure mode this sprint exists to remove.
   * @covers AC-COMPLEXITY-001
   */
  it('keeps a malformed span that closes early out of the correction path', () => {
    const mod = require(reportPath);
    // The linter reports a span starting on the opening brace and ending far
    // past the function. Whatever the numbers, the row must either be corrected
    // to a defensible value or be reported as unlocatable — never passed through
    // as if the original number were trustworthy.
    const lines = ['function f() {', '  if (a) { return 1; }', '}', 'const tail = 2;', 'const more = 3;'];
    const res = mod.verifyRowCcn({ srcLines: lines, name: 'f', ccn: 99, lineNo: 1, endNo: 5 });
    const trustworthy = res.corrected === true || res.unlocatable === true;
    expect(trustworthy).toBe(true);
    if (res.corrected) {
      expect(res.ccn).toBeLessThan(99);
    }
  });

  it('is idempotent: verifying an already-correct count does not invent a change', () => {
    const mod = require(reportPath);
    const lines = ['function g() {', '  if (a) { return 1; }', '}', ''];
    const first = mod.verifyRowCcn({ srcLines: lines, name: 'g', ccn: 99, lineNo: 1, endNo: 3 });
    expect(first.corrected).toBe(true);
    const again = mod.verifyRowCcn({ srcLines: lines, name: 'g', ccn: first.ccn, lineNo: 1, endNo: 3 });
    // Re-verifying the corrected value must agree with itself.
    expect(again.unlocatable).not.toBe(true);
    expect(again.ccn).toBe(first.ccn);
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent The --check verdict must be the same judgment the pre-commit hook
   *         makes, and it must be able to fail at all. Before this existed the
   *         report could only print numbers: nothing in CI consulted the
   *         baseline, so a function could regress indefinitely.
   * @covers AC-RATCHET-001, AC-RATCHET-002
   */
  describe('ratchetFindings', () => {
    const row = (over) => ({ file: 'src/a.ts', bucket: 'production', name: 'f', ccn: 5, nloc: 5, line: 10, ...over });

    it('blocks a function that got worse than its recorded baseline', () => {
      const mod = require(reportPath);
      const findings = mod.ratchetFindings({ functions: [row({ ccn: 9 })], unverified_rows: [] }, { 'src/a.ts::f': 8 });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('BLOCK');
      expect(findings[0]).toContain('baseline=8');
    });

    it('passes a function at or below its baseline', () => {
      const mod = require(reportPath);
      const at = mod.ratchetFindings({ functions: [row({ ccn: 8 })], unverified_rows: [] }, { 'src/a.ts::f': 8 });
      const below = mod.ratchetFindings({ functions: [row({ ccn: 6 })], unverified_rows: [] }, { 'src/a.ts::f': 8 });
      expect(at).toEqual([]);
      expect(below).toEqual([]);
    });

    it('grades an unrecorded function against the flat thresholds', () => {
      const mod = require(reportPath);
      const over = mod.ratchetFindings({ functions: [row({ ccn: 11 })], unverified_rows: [] }, {});
      expect(over).toHaveLength(1);
      expect(over[0]).toContain('BLOCK');
      const under = mod.ratchetFindings({ functions: [row({ ccn: 10 })], unverified_rows: [] }, {});
      expect(under).toEqual([]);
    });

    it('treats an unverifiable row as blocking, not as compliance', () => {
      const mod = require(reportPath);
      const findings = mod.ratchetFindings({ functions: [], unverified_rows: ['src/a.ts:10 f CCN=12'] }, {});
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('could not be span-verified');
    });

    it('keys two same-named functions by line so they cannot shadow each other', () => {
      const mod = require(reportPath);
      const report = {
        functions: [row({ name: 'walk', ccn: 8, line: 79 }), row({ name: 'walk', ccn: 7, line: 184 })],
        unverified_rows: [],
      };
      // Only the line-79 declaration is recorded. The line-184 one must not
      // inherit that entry and be reported as an improvement to CCN 8.
      const findings = mod.ratchetFindings(report, { 'src/a.ts::walk@79': 8 });
      expect(findings).toEqual([]);
      // Conversely, a regression on EITHER row is caught.
      const regressed = mod.ratchetFindings(report, { 'src/a.ts::walk@79': 7 });
      expect(regressed).toHaveLength(1);
      expect(regressed[0]).toContain(':79');
    });
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent A ratchet with no baseline silently grades every function as new
   *         code; --check must refuse to run rather than report a vacuous OK.
   * @covers AC-RATCHET-003
   */
  it('--check fails closed when the baseline file is missing', () => {
    const { spawnSync } = require('node:child_process');
    const dir = makeFixtureTree();
    try {
      const res = spawnSync(process.execPath, [reportPath, '--root', dir, '--check', '--baseline', path.join(dir, 'absent.json')], {
        encoding: 'utf8',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('baseline not found');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent A failed measurement must never look like a successful empty one.
   *         runLizardOne used to resolve to '' on any error, which read as "this
   *         file has zero functions" and dropped it from the baseline and the
   *         ratchet without a word. Equally important: the failure path must
   *         REJECT the promise. Throwing inside an execFile callback does not
   *         reject the surrounding promise — the executor has already returned,
   *         so the throw escapes and the promise hangs forever. All three
   *         walkthrough seats caught that independently.
   * @covers AC-COMPLEXITY-001
   */
  describe('runLizardOne failure handling', () => {
    it('rejects instead of hanging when the linter cannot run', async () => {
      const mod = require(reportPath);
      // A command that does not exist: execFile yields an error and no stdout.
      await expect(mod.runLizardOne('xp-gate-no-such-linter', process.cwd(), 'src/a.ts')).rejects.toThrow(
        /no measurable output/
      );
    });

    it('accepts an empty result from a file with no functions', async () => {
      const mod = require(reportPath);
      // Real lizard, real file with no functions: it prints nothing and exits 0,
      // which is a legitimate zero rather than a failed measurement. Skipped
      // when lizard is absent so the suite still runs on a bare box.
      const { spawnSync } = require('node:child_process');
      const probe = spawnSync('lizard', ['--version'], { encoding: 'utf8' });
      if (probe.status !== 0) return;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-empty-'));
      try {
        fs.writeFileSync(path.join(dir, 'empty.js'), 'const x = 1;\nmodule.exports = { x };\n');
        const out = await mod.runLizardOne('lizard', dir, 'empty.js');
        expect(typeof out).toBe('string');
        expect(out.trim()).toBe('');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
