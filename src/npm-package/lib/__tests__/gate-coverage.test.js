/**
 * @test REQ-636 One command that shows compliance against EVERY gate
 * @intent Today the answer to "how healthy is this project against xp-gate's
 *        gates" takes six commands and mental arithmetic:
 *
 *          xp-gate gate-list && xp-gate check . --all && xp-gate doctor
 *          node scripts/ccn-report.cjs --check
 *          node -e "...sum .warnings-baseline.json..."
 *          gh run list
 *
 *        Every existing command answers "did THIS gate pass". None answers
 *        "where is the debt and what should I fix first".
 *
 *        The single most important property is that the view has FOUR states,
 *        not three. `passed / skipped / failed` merges "did not run" into
 *        "ran and was fine", and that is exactly where technical debt hides.
 *        A gate that never executed renders identically to a gate that passed
 *        clean -- a false green, which is the most dangerous output this
 *        tooling can produce.
 *
 *        Two data hazards drive the rest of the design:
 *
 *        - The producer artifact numbers its gates `gate9_build_integrity` and
 *          `gate10_sast`, but the CLI calls Build Integrity Gate 10 and SAST
 *          Gate 9 -- the two are SWAPPED. Rendering the artifact naively shows
 *          the user the wrong gate name, which is worse than showing nothing.
 *          The mapping is therefore keyed on the artifact's own taxonomy and
 *          pinned by a test.
 *
 *        - `quality-status/<branch>.json` records the commit it was generated
 *          from. Rendering it for a different HEAD silently presents stale
 *          results as current. This repo has had that artifact sit at an old
 *          commit for days, so staleness must be explicit, not inferred away.
 * @covers AC-636-01, AC-636-02, AC-636-03, AC-636-04, AC-636-05, AC-636-06
 */
'use strict';

const { renderGateCoverage, buildCoverageRows, STATUS } = require('../gate-coverage');

/** A `quality-status` artifact shaped like the real producer's output. */
function artifact(overrides) {
  return {
    reportVersion: '2.0',
    generatedAt: '2026-10-27T03:06:05Z',
    commit: 'a0bceb9c0000000000000000000000000000000',
    branch: 'main',
    language: 'typescript iac',
    overall: {
      gatesPassed: 6,
      gatesTotal: 12,
      gatesSkipped: 6,
      gatesWarned: 0,
      gatesFailed: 0,
      gatesEffective: 6,
      effectivePassRate: 100,
      scoreAllGates: 5,
      score: 10,
      verdict: 'PARTIAL',
      ...(overrides && overrides.overall ? overrides.overall : {}),
    },
    gates: {
      gate1_static_analysis: { name: 'Static Analysis', status: 'PASS', tool: 'eslint' },
      gate9_build_integrity: { name: 'Build Integrity', status: 'PASS', tool: 'tsc' },
      gate10_sast: { name: 'SAST Security', status: 'PASS', tool: 'semgrep' },
      ...(overrides && overrides.gates ? overrides.gates : {}),
    },
  };
}

describe('gate coverage — four states, never a false green (#636)', () => {
  it('AC-636-01: a gate that never ran is SKIP with a reason, never folded into PASS', () => {
    const rows = buildCoverageRows(artifact(), { headCommit: 'a0bceb9c0000000000000000000000000000000' });
    // Gates 0/1/5/11 are hook-only: they exist but the CLI cannot run them.
    const version = rows.find((r) => r.gate === 0);
    expect(version, 'Gate 0 must appear even though it never ran').toBeDefined();
    expect(version.status).toBe(STATUS.SKIP);
    // A bare SKIP is the false green. The reason is mandatory.
    expect(version.reason).toBeTruthy();
    // The reason must say WHY it did not run -- "hook only" and "not run here"
    // are both honest; a bare SKIP is not.
    expect(version.reason).toMatch(/hook|git commit|not run/i);
  });

  it('AC-636-02: the artifact gate-number swap does not mislabel the gates', () => {
    // The producer says gate9_* = Build Integrity; the CLI says Gate 10 is Build
    // Integrity. Rendering the artifact's own key would show SAST as Gate 10.
    const rows = buildCoverageRows(artifact(), { headCommit: 'a0bceb9c0000000000000000000000000000000' });
    const build = rows.find((r) => r.name === 'Build Integrity');
    const sast = rows.find((r) => r.name === 'SAST Security');
    expect(build, 'Build Integrity row must exist').toBeDefined();
    expect(sast, 'SAST row must exist').toBeDefined();
    // Both rows exist and carry the CLI's numbering, not the artifact's.
    expect(build.gate).toBe(10);
    expect(sast.gate).toBe(9);
  });

  it('AC-636-03: a stale artifact is marked STALE instead of presented as current', () => {
    const rows = buildCoverageRows(artifact(), { headCommit: 'ffffffffffffffffffffffffffffffffffffffff' });
    const rendered = renderGateCoverage(rows, { stale: true, headCommit: 'ffffffffffffffffffffffffffffffffffffffff' });
    expect(rendered).toMatch(/STALE/i);
  });

  it('AC-636-04: DEBT is observable and quantified, not rendered as a clean PASS', () => {
    // Gate 6 holds no warnings of its own; the debt lives in the Boy Scout
    // baseline. A view that only reads gate statuses reports "PASS" and hides it.
    const rows = buildCoverageRows(artifact(), {
      headCommit: 'a0bceb9c0000000000000000000000000000000',
      boyScout: { files: 14, warnings: 129 },
    });
    const boyScout = rows.find((r) => /boy scout/i.test(r.name));
    expect(boyScout).toBeDefined();
    expect(boyScout.status).toBe(STATUS.DEBT);
    expect(String(boyScout.debt)).toMatch(/129/);
    expect(boyScout.evidence).toMatch(/warnings-baseline/);
  });

  it('AC-636-05: default exit does not fail on DEBT, but --strict does', () => {
    const debtRows = [{ gate: 6, name: 'Boy Scout', status: STATUS.DEBT, debt: '1 warning' }];
    expect(buildCoverageRows).toBeDefined();
    const { exitCodeFor } = require('../gate-coverage');
    // Debt is budgeted and known: failing on it by default makes the command
    // unusable as a CI dashboard.
    expect(exitCodeFor(debtRows, {})).toBe(0);
    expect(exitCodeFor(debtRows, { strict: true })).toBe(1);
    // A real failure always fails.
    expect(exitCodeFor([{ gate: 7, name: 'x', status: STATUS.FAIL }], {})).toBe(1);
  });

  it('AC-636-06: every row carries evidence pointing at the artifact that decided it', () => {
    const rows = buildCoverageRows(artifact(), { headCommit: 'a0bceb9c0000000000000000000000000000000' });
    // Without Evidence the user can only trust a one-line claim; with it they
    // can go check. Same reason `doctor` prints paths.
    for (const row of rows) {
      expect(row.evidence, `Gate ${row.gate} (${row.name}) has no evidence pointer`).toBeTruthy();
    }
  });
});
