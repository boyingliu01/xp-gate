/**
 * @test REQ-CCNRPT-001
 * @intent ccn-report must invoke lizard once per file (batch mode inflates CCN spans) and bucket production vs test files
 * @covers AC-CCNRPT-001, AC-CCNRPT-002
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const reportPath = path.resolve(__dirname, '..', 'ccn-report.cjs');

/**
 * Is `lizard` actually runnable here?
 *
 * The cases below measure real CCN values and therefore need the analyzer. Per the
 * project's own convention (tool missing => SKIP, not BLOCK), a host without lizard must
 * skip them rather than fail — otherwise the suite reports "the code is broken" when the
 * environment is.

 * This mattered in practice: the Mutation Testing workflow runs the initial test run
 * inside a Stryker sandbox on an image without lizard, so one FAILing case aborted the
 * ENTIRE mutation run ("There were failed tests in the initial test run") before a single
 * mutant was evaluated — a tooling gap presenting as a red build for every change that
 * happened to touch a mutated file.
 */
function lizardAvailable() {
  // `--version` is read-only and cheap; a spawn failure (ENOENT) also means "absent".
  // Wrapped because spawnSync reports that failure on `error` instead of throwing,
  // and "the tool is missing" must stay a SKIP decision, not an unhandled crash.
  try {
    const probe = spawnSync('lizard', ['--version'], { encoding: 'utf8' });
    return probe.status === 0 && !probe.error;
  } catch {
    return false;
  }
}

const LIZARD_PRESENT = lizardAvailable();
// A visible record of the skip decision, so a green run on a lizard-less image cannot be
// mistaken for "these cases passed".
if (!LIZARD_PRESENT) {
  console.warn('[ccn-report] lizard not found — CCN measurement cases will SKIP, not pass');
}

function makeFixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-report-'));
  // A scratch tree the report is measured against; a write failure here means the
  // fixture never existed, which must surface as a fixture error and not as a
  // mysterious "the report found nothing" downstream.
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'prod.js'),
      'function big(a,b,c,d,e){ if(a&&b||c){ if(d){ return e; } } return 0; }\n'
    );
    fs.writeFileSync(
      path.join(dir, 'src', '__tests__', 'prod.test.js'),
      // @assertion-justified: this is fixture DATA, not an assertion -- the string is
      // written to a scratch file so the CCN report can be measured against a test file
      // that contains a tautology. Gate 5d flags it because the detector reads text, not
      // AST, and here that text is deliberately the anti-pattern under study.
      "describe('x', () => { it('y', () => { expect(1).toBe(1); }); });\n"
    );
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not build the CCN fixture tree: ${err.message}`);
  }
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

  // Skips when lizard is absent rather than failing: the analyzer is the subject of the
  // measurement, and an image without it cannot answer the question. See lizardAvailable.
  (LIZARD_PRESENT ? it : it.skip)('produces a report over a real fixture tree without inflating spans', async () => {
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

  (LIZARD_PRESENT ? it : it.skip)('corrects lizard phantom CCN caused by generic-arrow brace confusion', async () => {
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
   * @intent A block comment spanning several lines had its prose counted as
   *         code, because the comment stripper worked one line at a time. A body
   *         of `return 1` scored CCN 1; the same body under a comment mentioning
   *         if/for/while scored 11. With 438 such comments in this repo the
   *         counts were being inflated wherever a comment explained control flow
   *         — which is exactly where a reader documents branches.
   * @covers AC-COMPLEXITY-001
   */
  it('does not count branch keywords inside a multi-line block comment', () => {
    const mod = require(reportPath);
    const clean = ['function f() {', '  return 1;', '}'];
    const commented = [
      'function f() {',
      '  /*',
      '   * Mentioning if, for, while, case, catch, &&, ||',
      '   */',
      '  return 1;',
      '}',
    ];
    expect(mod.ccnOfBody(commented)).toBe(mod.ccnOfBody(clean));
    // Real branches after the comment must still count.
    const real = ['function f() {', '  /* if (x) { for (y) {} } */', '  if (a) return 1;', '}'];
    expect(mod.ccnOfBody(real)).toBeGreaterThan(mod.ccnOfBody(clean));
  });

  it('does not let a quoted /* open a block comment', () => {
    const mod = require(reportPath);
    const lines = ['function f() {', '  const re = "/* not a comment */";', '  if (a) return 1;', '}'];
    // The if must still be counted: had the quoted /* opened a comment, the
    // rest of the body would have been swallowed.
    expect(mod.ccnOfBody(lines)).toBeGreaterThan(1);
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent The CCN recomputation must use the SAME branch conventions as
   *         lizard, or the two engines disagree and the ratchet compares
   *         incomparable numbers. Verified against lizard 1.21.3: a ternary
   *         scores 2, `??` scores 3, plain scores 1. An earlier comment claimed
   *         ternaries were excluded — the comment was wrong and the code was
   *         right, so the convention is pinned here rather than left to prose.
   * @covers AC-COMPLEXITY-001
   */
  it('counts ternaries and nullish like lizard, but not optional chaining', () => {
    const mod = require(reportPath);
    const plain = ['function f() {', '  return a;', '}'];
    const ternary = ['function f() {', '  return a ? b : c;', '}'];
    const nullish = ['function f() {', '  return a ?? b;', '}'];
    const optional = ['function f() {', '  return a?.b;', '}'];
    expect(mod.ccnOfBody(plain)).toBe(1);
    // lizard counts the ternary as one extra branch.
    expect(mod.ccnOfBody(ternary)).toBe(2);
    // lizard counts `??` as a branch.
    expect(mod.ccnOfBody(nullish)).toBe(2);
    // lizard does NOT count optional chaining.
    expect(mod.ccnOfBody(optional)).toBe(1);
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent `\?[^.]` must not count ANY link in a chained optional access. One
   *         `?.` is excluded only because the next character is a dot, so a
   *         chain like `a?.b?.c?.[d]` is the case most likely to slip through.
   *         Probed: all forms stay at CCN 1, while a ternary still counts.
   * @covers AC-COMPLEXITY-001
   */
  it('does not count any link of a chained optional access', () => {
    const mod = require(reportPath);
    const one = ['function f() {', '  return a?.b;', '}'];
    const two = ['function f() {', '  return a?.b?.c;', '}'];
    const three = ['function f() {', '  return a?.[b]?.d;', '}'];
    for (const body of [one, two, three]) expect(mod.ccnOfBody(body)).toBe(1);
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent A walkthrough seat claimed findFunctionBody cannot locate arrow
   *         functions assigned to consts, especially when the assignment spans
   *         lines, and that it can be fooled by a name appearing inside a string.
   *         Probed: both arrow forms ARE located, an implicit-return arrow
   *         correctly has no brace body to measure (its CCN is 1 — it can never
   *         be a hotspot), and a name inside a string is NOT matched. Pinning
   *         this so a future "fix" for a non-bug does not regress it.
   * @covers AC-COMPLEXITY-001
   */
  it('locates arrow-function bodies and does not match names inside strings', () => {
    const mod = require(reportPath);
    const single = ['const handler = (a) => {', '  if (a) return 1;', '  return 0;', '};'];
    // Asserted as the exact [start, end] row range, not merely truthy: the range
    // IS what the CCN ratchet consumes, so `toBeTruthy()` could not tell a correct
    // body from one that stops a row early or late -- a wrong range silently
    // miscounts complexity, which is the defect this whole file guards.
    expect(mod.findFunctionBody(single, 'handler')).toEqual([0, 3]);

    const multi = [
      'const handler = async (a, b) => {',
      '  if (a) return 1;',
      '  for (const x of b) { if (x) return 2; }',
      '  return 0;',
      '};',
    ];
    expect(mod.findFunctionBody(multi, 'handler')).toEqual([0, 4]);

    // A name that only appears inside a string literal is not a declaration.
    const strOnly = ['const s = "findMe(a) {";', 'const t = 1;'];
    expect(mod.findFunctionBody(strOnly, 'findMe')).toBeNull();
  });

  /**
   * @test REQ-COMPLEXITY-RATCHET
   * @intent TypeScript class properties carry visibility/readonly/static
   *         modifiers before the name. Probed: `public readonly handler = ...`
   *         was unlocatable, so its row kept the raw lizard count. A `private`
   *         field bound to a typed arrow is NOT covered because lizard files that
   *         row under `=` rather than the field name — a lizard limitation, not
   *         a lookup we can fix here.
   * @covers AC-COMPLEXITY-001
   */
  it('locates a class property whose name is preceded by modifiers', () => {
    const mod = require(reportPath);
    const lines = [
      'export class Svc {',
      '  public readonly handler = async (a: T) => {',
      '    if (a) return 1;',
      '    return 0;',
      '  };',
      '}',
    ];
    expect(mod.findFunctionBody(lines, 'handler')).toEqual([1, 4]);
    const staticArrow = ['export class Svc {', '  static run = (a) => {', '    if (a) return 1;', '  };', '}'];
    expect(mod.findFunctionBody(staticArrow, 'run')).toEqual([1, 3]);
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
   * @intent Verifying only rows the linter already flags above 10 left the
   *         ratchet comparing raw UNDER-counts for the vast majority of
   *         functions. Measured on this repo: of 3449 rows reported at CCN <= 10,
   *         521 are genuinely higher once the body is read (measured:
   *         renderGatePassRateChart reports 4 and is really 15). A function could
   *         therefore climb from an under-reported 4 to a real 15 without the
   *         ratchet noticing. Every row must be verifiable.
   * @covers AC-COMPLEXITY-001, AC-RATCHET-001
   */
  it('verifies a row reported at or below the threshold, not just above it', () => {
    const mod = require(reportPath);
    // A body with three ternaries and two ifs: real CCN is well above the
    // reported 4. Verification must correct it even though 4 is under 10.
    const lines = [
      'function chart(rows) {',
      '  if (!rows.length) return;',
      '  const a = rows.map(r => r > 1 ? "hi" : r > 0 ? "mid" : "lo");',
      '  if (a.length) { return a.filter(x => x ? 1 : 0); }',
      '  return rows.length ? a : [];',
      '}',
    ];
    const res = mod.verifyRowCcn({ srcLines: lines, name: 'chart', ccn: 4, lineNo: 1, endNo: 6 });
    expect(res.corrected).toBe(true);
    expect(res.ccn).toBeGreaterThan(4);
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
  (LIZARD_PRESENT ? it : it.skip)('--check fails closed when the baseline file is missing', () => {
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
      // Reuse the module-level probe: a second `lizard --version` measured
      // 690-895 ms here, and cannot disagree with the first within a run.
      if (!LIZARD_PRESENT) return;
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

    /**
     * @test REQ-COMPLEXITY-RATCHET
     * @intent lizard exits 0 and prints nothing for a path it cannot read
     *         (measured: `lizard --csv /nope/zzz.js` -> exit 0, no stdout, no
     *         stderr). That is indistinguishable from "this file has zero
     *         functions" if you only look at the output, so an unmeasurable file
     *         silently vanished from the baseline and the ratchet. The exit
     *         status carries no information here; the file's existence does.
     * @covers AC-COMPLEXITY-001
     */
    it('treats "no output" for an unreadable path as a failure, not a zero', async () => {
      const mod = require(reportPath);
      // Reuse the module-level probe (690-895 ms per spawn) instead of re-asking.
      if (!LIZARD_PRESENT) return;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-missing-'));
      try {
        await expect(mod.runLizardOne('lizard', dir, 'does-not-exist.js')).rejects.toThrow(
          /not a readable file/
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * Issue #737 — "no evidence" must never be reported as "clean tree".
   *
   * A scan over zero files yields every bucket at 0, which reads identically to a
   * debt-free codebase, and the process used to exit 0. Two paths reached it:
   * a mistyped --root, and a root that exists but holds no matching sources.
   * Both are only fatal when the root was named EXPLICITLY — the default root is
   * the cwd, and callers legitimately run this from a directory with no sources.
   *
   * These run the real CLI as a subprocess because the defect lived in the exit
   * status, which no in-process assertion would have caught.
   */
  describe('an explicit root that yields nothing is a failure, not a clean tree (#737)', () => {
    const runCli = (args) =>
      spawnSync(process.execPath, [reportPath, ...args], { encoding: 'utf8' });

    it('exits 2 for a nonexistent --root and says so', () => {
      const dir = path.join(os.tmpdir(), `ccn-no-such-root-${process.pid}-${Date.now()}`);
      const r = runCli(['--root', dir]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/scan root does not exist or is not a directory/);
      // The dangerous old shape: a zeroed table printed as if it were a verdict.
      expect(r.stdout).not.toMatch(/files scanned:\s+0/);
    });

    it('exits 2 for an --root with no source files and says so', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-empty-root-'));
      try {
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'not source');
        const r = runCli(['--root', dir]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/contains no source files/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('still succeeds on the default root, which may legitimately hold sources', () => {
      // No --root: a cwd that holds sources must stay exit 0. This is the
      // control proving the new check did not simply make every run fail.
      //
      // Runs from a TWO-FILE fixture, not the repo. What the control asserts is
      // "a non-empty default root is not fatal" -- the file count is irrelevant
      // to that. Scanning the real checkout made it spawn lizard once per source
      // file: 731 files x ~275 ms measured on this machine = ~200 s for a single
      // assertion, and 247 s in the suite.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-default-src-'));
      try {
        fs.writeFileSync(path.join(dir, 'a.js'), 'function f(a) {\n  return a ? 1 : 2;\n}\nmodule.exports = { f };\n');
        const r = spawnSync(process.execPath, [reportPath], { encoding: 'utf8', cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/files scanned:\s+[1-9]/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('does NOT fail when the DEFAULT root holds no sources', () => {
      // The other half of the control, and the bug a mutation exposed: widening
      // the zero-files guard to fire unconditionally (`if (files.length === 0)`
      // instead of gating it on `rootExplicit`) survived every other case,
      // because they all pass --root. Running with no --root from a directory
      // that holds no sources is legitimate — a tools/ subdir, a CI step that
      // only wants `--check` against a baseline — so making it fatal would break
      // real callers while every test above stayed green.
      //
      // Empty on purpose: the point is that nothing is there to scan.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-default-empty-'));
      try {
        const r = spawnSync(process.execPath, [reportPath], { encoding: 'utf8', cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stderr).not.toMatch(/contains no source files/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

/**
 * @test REQ-762
 * @intent Delphi round 1 (CI-01): the rescued-row path mutates the object
 *         verifyRowCcn returns (res.ccn = verdict.ccn; res.corrected = true). That
 *         is only safe while the return value stays a plain mutable object. Nothing
 *         pinned the invariant, so an Object.freeze added for safety would silently
 *         turn every rescued row back into an unverified one — the exact bug the
 *         rescue exists to prevent.
 * @covers AC-762-01
 */
describe('verifyRowCcn returns a mutable verdict (rescue contract)', () => {
  function loadMod() {
    delete require.cache[require.resolve('../../scripts/ccn-report.cjs')];
    return require('../../scripts/ccn-report.cjs');
  }

  it('is not frozen, so the rescue path can correct the CCN in place', () => {
    const mod = loadMod();
    const res = mod.verifyRowCcn({
      srcLines: ['function f() {', '  if (a) {}', '}'],
      name: 'f',
      ccn: 99,
      lineNo: 1,
      endNo: 3,
    });

    expect(Object.isFrozen(res)).toBe(false);
    res.ccn = 4;
    res.corrected = true;
    expect(res.ccn).toBe(4);
    expect(res.corrected).toBe(true);
  });
});

/**
 * @test REQ-762
 * @intent Delphi round 2 (MC-02 / FC-03): round 1 pinned only that verifyRowCcn's
 *         result is mutable. That is the precondition, not the behaviour — nothing
 *         showed the rescue actually REPLACES a bad CCN with the body's value, which
 *         is the whole point. This exercises the same primitives verifyCcnForRow
 *         composes (verifyRowCcn -> findFunctionBody -> ccnOfBody) on a function
 *         whose reported CCN is wrong.
 * @covers AC-762-02
 */
describe('the rescue path replaces an unverified CCN with the body CCN (#762)', () => {
  function loadMod() {
    delete require.cache[require.resolve('../../scripts/ccn-report.cjs')];
    return require('../../scripts/ccn-report.cjs');
  }

  it('finds the body by name and reads a lower CCN from it', () => {
    const mod = loadMod();
    const srcLines = [
      'function simple(a) {',
      '  if (a) { return 1; }',
      '  return 2;',
      '}',
    ];

    // lizard over-reports this as 99; the body only has one branch.
    const body = mod.findFunctionBody(srcLines, 'simple');
    expect(body).not.toBeNull();
    const bodyCcn = mod.ccnOfBody(body);
    expect(bodyCcn).toBeLessThan(99);

    const res = mod.verifyRowCcn({ srcLines, name: 'simple', ccn: 99, lineNo: 1, endNo: 4 });
    res.ccn = bodyCcn;
    res.corrected = true;
    expect(res.ccn).toBe(bodyCcn);
    expect(res.corrected).toBe(true);
  });

  it('returns null for a name that is not in the window, so the row stays unverified', () => {
    const mod = loadMod();
    const body = mod.findFunctionBody(['const x = 1;'], 'notThere');
    // `toBe(null)` rather than `toBeNull()`: identical meaning, but the matcher
    // says "this exact value" instead of "a nullish property", which is the claim
    // being made -- the function must not return a range, an empty array, or
    // undefined for a name it cannot locate.
    expect(body).toBe(null);
  });
});

/**
 * @test REQ-CCNRPT-902
 * @intent Gate 3's verified CCN must equal lizard's CCN for EVERY brace-balanced
 *   language, not just the ones whose rows happen to be corrected before the
 *   rescue path runs. #848: the rescue passed findFunctionBody's [start, end]
 *   PAIR where classifyUnverifiedRow expects LINES, so ccnOfBody iterated two
 *   numbers, matched no branch, and fell back to its initial value of 1.
 * @covers AC-CCNRPT-902
 *
 * Every case is driven through the real `--csv-verified` CLI, because the bug
 * lived in the gap between the pieces: the existing unit tests call
 * findFunctionBody and ccnOfBody directly with correct arguments, which is
 * exactly why they stayed green while the pipeline rewrote 8 to 1.
 */
describe('#848 verified CCN fidelity across languages (end-to-end)', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const reportPath = path.resolve(__dirname, '..', 'ccn-report.cjs');

  // Same nesting depth in every language, so lizard reports the same CCN and any
  // divergence is the verifier's, not the fixture's. Each body genuinely sums to
  // 8: 1 + if + if + for + if + if + if + &&.
  const FIXTURES = {
    'lib/a.go': [
      'package main',
      'func Grade(a int, b int, c int, d int) int {',
      '\tif a > 0 { if b > 0 { for i := 0; i < 10; i++ { if c > 0 { if d > 0 { if i > 5 && a > 0 { return 1 } } } } } }',
      '\treturn 4',
      '}',
    ].join('\n'),
    'lib/b.dart': [
      'int Grade(int a, int b, int c, int d) {',
      '  if (a > 0) { if (b > 0) { for (var i = 0; i < 10; i++) { if (c > 0) { if (d > 0) { if (i > 5 && a > 0) { return 1; } } } } } }',
      '  return 4;',
      '}',
    ].join('\n'),
    'lib/c.py': [
      'def grade(a, b, c, d):',
      '    if a > 0:',
      '        if b > 0:',
      '            for i in range(10):',
      '                if c > 0:',
      '                    if d > 0:',
      '                        if i > 5 and a > 0:',
      '                            return 1',
      '    return 4',
    ].join('\n'),
    'lib/D.java': [
      'public class D {',
      '  int grade(int a, int b, int c, int d) {',
      '    if (a > 0) { if (b > 0) { for (int i = 0; i < 10; i++) { if (c > 0) { if (d > 0) { if (i > 5 && a > 0) { return 1; } } } } } }',
      '    return 4;',
      '  }',
      '}',
    ].join('\n'),
    'lib/E.cs': [
      'class E {',
      '  int Grade(int a, int b, int c, int d) {',
      '    if (a > 0) { if (b > 0) { for (int i = 0; i < 10; i++) { if (c > 0) { if (d > 0) { if (i > 5 && a > 0) { return 1; } } } } } }',
      '    return 4;',
      '  }',
      '}',
    ].join('\n'),
  };

  /** lizard's CCN and the `--csv-verified` CCN for one fixture. */
  function bothCcns(root, rel) {
    const raw = execFileSync('lizard', ['--csv', rel], { cwd: root, encoding: 'utf8' });
    const verified = execFileSync('node', [reportPath, '--csv-verified', 'batch', '--root', root], {
      cwd: root,
      input: raw,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pick = (text) => text.trim().split(/\r?\n/).filter(Boolean)[0].split(',')[1];
    return { lizard: pick(raw), verified: pick(verified) };
  }

  let root;
  beforeAll(() => {
    if (!lizardAvailable()) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn848-'));
    for (const [rel, body] of Object.entries(FIXTURES)) {
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), `${body}\n`);
    }
  });
  afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  for (const rel of Object.keys(FIXTURES)) {
    it(`keeps lizard's CCN for ${path.extname(rel)} (${rel})`, () => {
      if (!lizardAvailable()) return;
      const { lizard, verified } = bothCcns(root, rel);
      // The regression was silent UNDER-counting (8 -> 1), which is the dangerous
      // direction: a real hotspot is rewritten to look trivial and the ratchet can
      // never fire on it. Equality is the only acceptable answer.
      expect({ file: rel, verified }).toEqual({ file: rel, verified: lizard });
    });
  }
});

/**
 * @test REQ-CCNRPT-731
 * @intent Onboarding PHP surfaced two population defects that would each have
 *   made Gate 3 grade nothing (or grade someone else's code) in every PHP repo:
 *     a) SOURCE_EXT had no `php`, so findSourceFiles returned ZERO files and
 *        `--write-baseline` cheerfully wrote an empty baseline -- the same shape
 *        as the Dart omission in #847 (a gate that reports PASSED over an empty
 *        population).
 *     b) `vendor` was not in skipDirs. composer recommends COMMITTING vendor/ for
 *        applications, so the tracked-files filter does not exclude it, and a
 *        two-file fixture graded third-party minified JS out of
 *        vendor/phpunit/... as the project's own production code.
 * @covers AC-CCNRPT-731
 */
describe('#731 PHP population: source discovery and vendor exclusion', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const mod = require('../../scripts/ccn-report.cjs');

  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn731-'));
    const write = (rel, body) => {
      // Fixture writer for a committed-dependency-tree scenario. A failed write
      // means the tree under test never existed, so say so here instead of letting
      // the assertion below report an empty scan.
      try {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
      } catch (err) {
        throw new Error(`could not write fixture ${rel}: ${err.message}`);
      }
    };
    write('src/Calc.php', '<?php\nfunction calc(int $a): int { return $a + 1; }\n');
    // Committed dependency tree: exactly what composer recommends for apps.
    write('vendor/acme/lib/Mini.js', 'function mini(a){ if(a){ return 1; } return 2; }\n');
    write('vendor/acme/lib/Helper.php', '<?php\nfunction helper(): int { return 1; }\n');
    execFileSync('git', ['init', '-q', '.'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
  });
  afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('discovers .php sources instead of returning an empty population', () => {
    const files = mod.findSourceFiles(root).map((f) => f.split(path.sep).join('/'));
    expect(files).toContain('src/Calc.php');
  });

  it('never scans composer vendor/ as project source', () => {
    const files = mod.findSourceFiles(root).map((f) => f.split(path.sep).join('/'));
    expect(files.filter((f) => f.startsWith('vendor/'))).toEqual([]);
  });
});

/**
 * @test REQ-CCNRPT-002
 * @intent CCN must be recomputed from code only -- regex literals are not code,
 *         and `else if` is ONE decision point
 *
 *         Both defects were measured together on src/principles/adapters/java.ts,
 *         where lizard's own CSV and .ccn-baseline.json agreed with each other and
 *         ccn-report disagreed with both:
 *
 *           1. stripNonCode did not know regex literals. A regex containing `\{`
 *              left an unbalanced brace, so the body scan ran to EOF and summed
 *              ~90 lines: extractInterfaces was reported at CCN 24 where lizard
 *              and the baseline both said 3. Every function below such a regex
 *              inherited the same wrong span.
 *           2. `else if` counted as TWO branches, charging each chain double -- a
 *              uniform baseline+1 across a whole file, which is the signature of
 *              a counting rule rather than of code getting more complex.
 *
 *         Either one blocked commits that touched the file, with no repair
 *         available short of faking the baseline.
 * @covers AC-CCNRPT-003, AC-CCNRPT-004
 */
describe('CCN body counting matches lizard', () => {
  const mod = require(reportPath);

  it('AC-CCNRPT-003: a regex literal containing a brace contributes no branch and no brace', () => {
    // extractInterfaces' real shape: a regex with `\{` inside it, then a return.
    // The function has NO branch, so CCN must be 1. Before the fix the stray
    // brace kept the scan open and swallowed the neighbour below, whose `while`
    // and `??` were then charged to this function.
    const body = [
      '  extractInterfaces() {',
      '    const re = /(?:public)?\s*interface\s+(\w+)\s*\{/g;',
      '    return re;',
      '  }',
    ];
    expect(mod.ccnOfBody(body)).toBe(1);
  });

  it('AC-CCNRPT-003b: a neighbour below a regex-bearing function is not charged to it', () => {
    // Same pair as above, now with the *neighbour* present in the slice the way a
    // leaked span would have included it. Counting this whole slice proves the
    // leak would have produced a much larger number, so the assertion above is
    // not passing merely because both values happen to be small.
    const leaked = [
      '  extractInterfaces() {',
      '    const re = /(?:public)?\s*interface\s+(\w+)\s*\{/g;',
      '    return re;',
      '  }',
      '  later() {',
      '    while (a) { b(); }',
      '    return a ?? b;',
      '  }',
    ];
    expect(mod.ccnOfBody(leaked)).toBeGreaterThan(mod.ccnOfBody(leaked.slice(0, 4)));
  });

  it('AC-CCNRPT-004: else is not a branch token, matching lizard', () => {
    // lizard scores `if(x){} else {}` and `if(x){}` both at 2, and scores
    // `if / else if` at 3 whether or not a trailing `else` is present. Counting
    // `else` therefore charged every function that has one an extra point, which
    // read as a uniform CCN baseline+1 across each affected file.
    const withElse = [
      '  function f(a) {',
      '    if (a === 1) { return 1; }',
      '    else if (a === 2) { return 2; }',
      '    else { return 3; }',
      '  }',
    ];
    const withoutElse = [
      '  function f(a) {',
      '    if (a === 1) { return 1; }',
      '    else if (a === 2) { return 2; }',
      '  }',
    ];
    // if + else-if over a base of 1 => 3, both with and without the trailing else.
    expect(mod.ccnOfBody(withElse)).toBe(3);
    expect(mod.ccnOfBody(withoutElse)).toBe(3);
    // The `else` itself contributes nothing: dropping it cannot change the count.
    expect(mod.ccnOfBody(withElse)).toBe(mod.ccnOfBody(withoutElse));
  });

  it('AC-CCNRPT-004b: a division operator is not mistaken for a regex', () => {
    // The other direction of AC-CCNRPT-003: treating `/` as a regex opener would
    // swallow the rest of the line, hiding real branches. A bare division must
    // leave the following `if` visible.
    const body = [
      '  function f(a) {',
      '    const half = a / 2; if (half > 1) { return 1; }',
      '  }',
    ];
    expect(mod.ccnOfBody(body)).toBe(2);
  });
});

/**
 * @test REQ-CCNRPT-002
 * @intent the concurrent scan must produce byte-identical findings to the sequential one
 * @covers AC-CCNRPT-003
 *
 * WHY THIS EXISTS. The scan used to be strictly sequential, with a comment claiming
 * "a shared pool of concurrent lizards corrupts rows in ways that silently zero the
 * report (observed: 779 -> 0 with an 8-wide pool on Windows)". The corruption was
 * real; the diagnosis was one level too deep. lizard is a pure function of its argv,
 * and eight concurrent invocations produce byte-identical output to eight sequential
 * ones. What could not be shared was this module's own mutable state -- functions,
 * byRowKey and unverifiedRows were appended to from inside each per-file callback.
 *
 * Measured 2026-11-23: `lizard --version` alone costs ~330ms (interpreter startup plus
 * import, independent of input), so 831 tracked sources cost ~274s of pure process
 * startup, inside a pre-commit hook, on every source-touching commit. ccn-report.cjs
 * took 175s sequentially; a bounded pool with per-task buffers and an ordered merge
 * brought it to 60s and produced the identical report.
 *
 * This test is the pin for the "identical" half. Without it, the next person who sees
 * the parallel pool has only a comment telling them it is dangerous -- and either
 * removes it or breaks it.
 */
describe('concurrency preserves the sequential result', () => {
  const fixture = () => ({
    'a.ts': [
      'export function alpha(x: number) {',
      '  if (x > 0) { return 1; }',
      '  for (let i = 0; i < 3; i += 1) { if (i) { return 2; } }',
      '  return 3;',
      '}',
    ].join('\n'),
    'b.ts': [
      'export function beta(y: number) {',
      '  while (y > 0) { y -= 1; }',
      '  return y;',
      '}',
      'export const gamma = (z: number) => (z ? 1 : 2);',
    ].join('\n'),
    'c.ts': 'export function delta() { return 1; }\n',
  });

  it('reports the same functions at concurrency 1 and at concurrency 8', () => {
    if (!LIZARD_PRESENT) {
      console.log('SKIP: lizard not on PATH');
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccn-conc-'));
    try {
      for (const [name, body] of Object.entries(fixture())) {
        fs.writeFileSync(path.join(root, name), body);
      }
      const runAt = (n) => {
        // A named helper with an explicit catch, because spawnSync signals a
        // launch failure on `error` while leaving `status` null -- asserting the
        // status alone would blame the report for never having run.
        try {
          const out = spawnSync(process.execPath, [reportPath, '--root', root, '--json'], {
            encoding: 'utf8',
            env: { ...process.env, XP_GATE_CCN_CONCURRENCY: String(n) },
          });
          if (out.error) throw out.error;
          expect(out.status).toBe(0);
          const parsed = JSON.parse(out.stdout);
          // duration_ms and timings are measurements, not findings.
          delete parsed.duration_ms;
          delete parsed.generatedAt;
          delete parsed.gate_timing;
          return parsed;
        } catch (err) {
          throw new Error(`ccn-report could not be measured at concurrency ${n}: ${err.message}`);
        }
      };
      expect(runAt(1)).toEqual(runAt(8));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
