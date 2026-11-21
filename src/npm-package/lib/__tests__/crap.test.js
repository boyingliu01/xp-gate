/**
 * @test REQ-404 CRAP advisory ranking
 * @intent Verify the CRAP indicator ranks "complex and weakly tested" functions
 *         without silently treating missing coverage as either perfect or zero,
 *         and that it never presents itself as a blocking gate (#404 P1-2).
 * @covers AC-404
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computeCrap,
  joinCoverage,
  buildCrapReport,
  isMirrorPath,
  readFileCoverage,
} = require('../crap.js');

describe('crap.js - CRAP formula', () => {
  it('computes comp^2 * (1 - cov) + comp', () => {
    // CCN 10, 50% covered -> 100 * 0.5 + 10 = 60
    expect(computeCrap(10, 0.5)).toBeCloseTo(60, 5);
    // CCN 4, fully covered -> 0 + 4 = 4
    expect(computeCrap(4, 1)).toBeCloseTo(4, 5);
    // CCN 12, no coverage -> 144 + 12 = 156
    expect(computeCrap(12, 0)).toBeCloseTo(156, 5);
  });

  it('returns null when coverage is unknown rather than guessing', () => {
    // The whole reason this function exists: an unmeasured function must not be
    // scored as if it were untested (that inflates it to the top of the ranking)
    // nor as if it were fully tested (that hides it). It is simply unmeasured.
    expect(computeCrap(10, null)).toBeNull();
    expect(computeCrap(10, undefined)).toBeNull();
    expect(computeCrap(10, NaN)).toBeNull();
  });

  it('clamps out-of-range coverage instead of producing negative scores', () => {
    // Istanbul occasionally reports slightly out-of-range values; a negative
    // CRAP would sort below genuinely clean functions and hide a hotspot.
    expect(computeCrap(5, 1.2)).toBeCloseTo(5, 5);
    expect(computeCrap(5, -0.1)).toBeCloseTo(30, 5);
  });
});

describe('crap.js - coverage joining', () => {
  it('joins per-file coverage using a repo-relative path', () => {
    const coverage = new Map([['src/a.ts', 0.5]]);
    const functions = [{ file: 'src/a.ts', name: 'f', ccn: 10 }];
    const joined = joinCoverage(functions, coverage);
    expect(joined).toHaveLength(1);
    expect(joined[0].cov).toBeCloseTo(0.5, 5);
    expect(joined[0].crap).toBeCloseTo(60, 5);
  });

  it('marks functions whose file has no coverage as unmeasured', () => {
    const coverage = new Map([['src/a.ts', 0.5]]);
    const functions = [{ file: 'src/never-loaded.ts', name: 'g', ccn: 20 }];
    const joined = joinCoverage(functions, coverage);
    expect(joined[0].cov).toBeNull();
    expect(joined[0].crap).toBeNull();
  });
});

describe('crap.js - report', () => {
  const functions = [
    { file: 'src/gates/gate-7.ts', name: 'runGate7', ccn: 14, cov: 0 },
    { file: 'src/gates/ok.ts', name: 'clean', ccn: 3, cov: 1 },
    { file: 'src/gates/mid.ts', name: 'mid', ccn: 9, cov: 0.8 },
  ];

  it('ranks by CRAP descending and drops functions below the bar', () => {
    const report = buildCrapReport(functions, { threshold: 6 });
    // clean: 9 * 0 + 3 = 3 -> below the bar, excluded
    // mid:   81 * 0.2 + 9 = 25.2
    // runGate7: 196 + 14 = 210
    expect(report.hotspots.map((h) => h.name)).toEqual(['runGate7', 'mid']);
    expect(report.hotspots[0].crap).toBeCloseTo(210, 5);
  });

  it('reports how many functions could not be measured', () => {
    const withUnknown = [
      ...functions,
      { file: 'src/gates/never.ts', name: 'nope', ccn: 30, cov: null },
    ];
    const report = buildCrapReport(withUnknown, { threshold: 6 });
    expect(report.unmeasured).toBe(1);
    expect(report.measured).toBe(3);
  });

  it('labels itself advisory', () => {
    const report = buildCrapReport(functions, { threshold: 6 });
    // A ranking nobody is blocked by must say so; the RFC is explicit that this
    // navigates refactoring and does not replace security/performance review.
    expect(report.advisory).toBe(true);
    expect(report.blocking).toBe(false);
  });

  it('honours an explicit top-N limit', () => {
    const report = buildCrapReport(functions, { threshold: 6, top: 1 });
    expect(report.hotspots).toHaveLength(1);
  });
});

describe('crap.js - mirror exclusion', () => {
  it('recognises the generated npm-package mirror', () => {
    // Refactoring a mirror is refactoring a copy that prepack overwrites.
    expect(isMirrorPath('src/npm-package/lib/doctor.js')).toBe(true);
    expect(isMirrorPath('src/npm-package/principles/config.ts')).toBe(true);
  });

  it('does not treat real source as a mirror', () => {
    expect(isMirrorPath('src/gates/gate-7.ts')).toBe(false);
    expect(isMirrorPath('plugins/qoder/src/index.ts')).toBe(false);
  });

  it('excludes mirror-tree functions from the ranking by default', () => {
    // A mirror hotspot outranks everything real (measured: findBodyBrace at
    // CRAP 4830 for being a big untested generated copy), so the default has to
    // be exclusion or the ranking is useless out of the box.
    const mixed = [
      { file: 'src/npm-package/lib/huge.js', name: 'mirrorFn', ccn: 60, cov: 0 },
      { file: 'src/gates/real.ts', name: 'realFn', ccn: 10, cov: 0 },
    ];
    const report = buildCrapReport(mixed, { threshold: 6 });
    expect(report.hotspots.map((h) => h.name)).toEqual(['realFn']);
  });

  it('includes mirrors only when explicitly asked', () => {
    const mixed = [
      { file: 'src/npm-package/lib/huge.js', name: 'mirrorFn', ccn: 60, cov: 0 },
      { file: 'src/gates/real.ts', name: 'realFn', ccn: 10, cov: 0 },
    ];
    const report = buildCrapReport(mixed, { threshold: 6, mirrors: true });
    expect(report.hotspots.map((h) => h.name)).toEqual(['mirrorFn', 'realFn']);
  });
});

/**
 * @test REQ-CRAP-858 `xp-gate crap` must accept the coverage Node itself produces
 * @intent #858: handleCrap only looked for istanbul's `coverage/coverage-final.json`.
 *         A project using Node's built-in runner —
 *
 *           node --test --experimental-test-coverage
 *
 *         — gets `coverage/coverage-summary.json` and NEVER a coverage-final.json,
 *         so `xp-gate crap` was permanently unavailable there, not merely
 *         "coverage not generated yet". Measured on a real repo whose Gate 5
 *         accepted the same artifact at 86.82% lines while CRAP said
 *         "No coverage artifact".
 *
 *         Two artifacts, two shapes:
 *
 *           istanbul coverage-final.json   { "<abs path>": { s: { "<id>": count } } }
 *           node coverage-summary.json     { "total": {...}, "<path>": { lines: {pct}, ... } }
 *
 *         readFileCoverage knew only the first. Given the second it found no
 *         `entry.s` anywhere and returned an empty map — which surfaces as "every
 *         function unmeasured", indistinguishable from having no coverage at all.
 *
 *         CRAP is the tool that finds "which function most needs a test", so the
 *         cost of this gap is the ranking itself: the repo's worst file
 *         (functions 25%) was diluted by an 86.82% overall figure that Gate 5
 *         passes, and CRAP was the only thing positioned to surface it.
 *
 * @covers AC-858-01 the Node summary format is read into per-file ratios
 * @covers AC-858-02 istanbul output still reads exactly as before
 * @covers AC-858-03 a file with no function data does not become a fabricated 0
 * @covers AC-858-04 an unrecognised JSON shape yields no coverage, not bogus values
 */
describe('#858 readFileCoverage accepts Node coverage-summary.json', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crap858-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeCoverage(name, payload) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(payload));
    return p;
  }

  it('AC-858-01: reads node coverage-summary.json into per-file ratios', () => {
    const file = writeCoverage('coverage-summary.json', {
      total: { lines: { total: 100, covered: 80, pct: 80 } },
      [`${dir}/tools.mjs`]: {
        lines: { total: 100, covered: 52, pct: 52.26 },
        branches: { total: 10, covered: 10, pct: 100 },
        functions: { total: 4, covered: 1, pct: 25 },
      },
    });

    const coverage = readFileCoverage(file);
    // The per-file ratio is keyed repo-relative, like the istanbul reader.
    const key = [...coverage.keys()].find((k) => k.endsWith('tools.mjs'));
    expect(key).toBeDefined();
    // Node reports functions 25%; that is the factor CRAP needs.
    expect(coverage.get(key)).toBeCloseTo(0.25, 2);
  });

  it('AC-858-02: istanbul coverage-final.json still reads as before', () => {
    const file = writeCoverage('coverage-final.json', {
      [`${dir}/alpha.js`]: { s: { '0': 1, '1': 0, '2': 1, '3': 1 } },
    });

    const coverage = readFileCoverage(file);
    const key = [...coverage.keys()].find((k) => k.endsWith('alpha.js'));
    expect(key).toBeDefined();
    expect(coverage.get(key)).toBeCloseTo(0.75, 5);
  });

  it('AC-858-03: an entry with no measurable data is skipped, not scored 0', () => {
    // `total` carries no filename; a file entry with no functions/lines data
    // must not be recorded as 0% -- that would push every such file to the top
    // of the ranking on evidence that does not exist. Unmeasured is not zero.
    const file = writeCoverage('coverage-summary.json', {
      total: { lines: { total: 10, covered: 10, pct: 100 } },
      [`${dir}/measured.mjs`]: { functions: { total: 2, covered: 1, pct: 50 } },
      [`${dir}/empty.mjs`]: {},
    });

    const coverage = readFileCoverage(file);
    expect([...coverage.keys()].some((k) => k.endsWith('measured.mjs'))).toBe(true);
    expect([...coverage.keys()].some((k) => k.endsWith('empty.mjs'))).toBe(false);
  });

  it('AC-858-03b: the "total" aggregate is not recorded as a file', () => {
    // Node writes a "total" entry holding the whole-project ratio. It has no
    // filename, and recording it put a phantom path in the map that no source
    // file could ever match -- while reading, to a human, like a real measurement.
    const file = writeCoverage('coverage-summary.json', {
      total: { lines: { total: 100, covered: 80, pct: 80 } },
      [`${dir}/real.mjs`]: { functions: { total: 4, covered: 1, pct: 25 } },
    });

    const coverage = readFileCoverage(file);
    expect(coverage.has('total')).toBe(false);
    expect([...coverage.keys()].some((k) => k === 'total')).toBe(false);
    expect(coverage.size).toBe(1);
  });

  it('AC-858-03c: a POSIX-spelled absolute path is joinable, not ../../d/...', () => {
    // Node on Windows writes "/d/projects/repo/src/x.mjs" while process.cwd() is
    // "D:\projects\repo". Both pass path.isAbsolute, so path.relative compared two
    // drive spellings and returned "../../d/projects/.../x.mjs" -- a key that
    // matched no source file, making every function look unmeasured (#858).
    // The fixture is derived from the real cwd so the assertion holds on any drive.
    const cwd = process.cwd();
    const drive = /^([A-Za-z]):/.exec(cwd);
    if (!drive) {
      // POSIX: no drive-letter mismatch to reproduce.
      return;
    }
    const posixPath = `/${drive[1].toLowerCase()}${cwd.slice(2).split(path.sep).join('/')}/src/posixy.mjs`;
    const file = writeCoverage('coverage-summary.json', {
      total: { lines: { total: 1, covered: 1, pct: 100 } },
      [posixPath]: { functions: { total: 4, covered: 1, pct: 25 } },
    });

    const coverage = readFileCoverage(file);
    const keys = [...coverage.keys()];
    expect(keys).toEqual(['src/posixy.mjs']);
    expect(coverage.get('src/posixy.mjs')).toBeCloseTo(0.25, 5);
  });

  it('AC-858-04: an unrecognised JSON shape yields an empty map, never a guess', () => {
    const file = writeCoverage('weird.json', { foo: 'bar', baz: [1, 2, 3] });
    const coverage = readFileCoverage(file);
    expect(coverage.size).toBe(0);
  });
});

/**
 * @test REQ-CRAP-858-B the CLI finds a Node coverage artifact without being told
 * @intent Reading coverage-summary.json (above) is useless if handleCrap never
 *         looks for it. The default path was hardcoded to istanbul's
 *         coverage-final.json, so a project producing only the Node summary was
 *         told "No coverage artifact" while the file sat right there.
 *         Pinned separately because the reader and the discovery are two
 *         different failures with the same symptom.
 * @covers AC-858-05 an existing coverage-summary.json is discovered
 * @covers AC-858-06 istanbul still wins when both exist, and --coverage overrides
 */
describe('#858 discoverCoverageFile', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { discoverCoverageFile } = require('../crap-cli.js');

  // vitest workers forbid process.chdir(), so the root is passed in. The
  // production default is process.cwd(); that is exercised end-to-end below.
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crap858b-'));
    fs.mkdirSync(path.join(dir, 'coverage'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC-858-05: discovers coverage-summary.json when it is the only artifact', () => {
    fs.writeFileSync(path.join(dir, 'coverage', 'coverage-summary.json'), '{}');
    expect(discoverCoverageFile(null, dir)).toBe(path.join(dir, 'coverage', 'coverage-summary.json'));
  });

  it('AC-858-06: prefers istanbul when both exist, and --coverage always wins', () => {
    fs.writeFileSync(path.join(dir, 'coverage', 'coverage-summary.json'), '{}');
    fs.writeFileSync(path.join(dir, 'coverage', 'coverage-final.json'), '{}');
    expect(discoverCoverageFile(null, dir)).toBe(path.join(dir, 'coverage', 'coverage-final.json'));

    expect(discoverCoverageFile('/tmp/explicit.json')).toBe('/tmp/explicit.json');
  });
});
