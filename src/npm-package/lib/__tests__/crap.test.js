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
