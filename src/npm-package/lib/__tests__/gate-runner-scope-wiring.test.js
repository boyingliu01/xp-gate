/**
 * @test REQ-820
 * @intent `xp-gate check --all` claims a whole-tree audit. The runner already
 *   built `GATE_SCOPE="all"` — but only as a **shell prefix** for the bash
 *   adapters. The TypeScript gates run in a SEPARATE PROCESS via `spawnSync`,
 *   and that call passed no `env`, so `GATE_SCOPE` never reached them. Gate
 *   3/7/8/9 kept calling `getChangedFiles()` → `git diff --cached`, and on a
 *   clean index they scanned nothing and reported the tree clean.
 *
 *   Measured on a repo with ~60 tracked `.ts` files (semgrep 1.186.0):
 *
 *     $ xp-gate check --all
 *     → Gate 10: Semgrep SAST Security Scan...
 *          ⏭️  SKIPPED - SAST (no supported language files changed)
 *
 *   while `semgrep --config=auto src/` over the same tree returned 5 findings,
 *   two of them real. The gate said "nothing to scan" over a non-empty set.
 *
 *   These tests pin the WIRING, not the gate logic: a unit test that sets
 *   `process.env.GATE_SCOPE` itself proves the module reads the variable, but
 *   says nothing about whether the runner ever sets it. That gap is exactly how
 *   this defect survived #589 and #616.
 * @covers AC-820-01, AC-820-02, AC-820-03
 */
const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', 'gate-runner.js');

/** The source text, for structural assertions on the spawn call. */
const runnerSource = fs.readFileSync(RUNNER, 'utf8');

describe('runTsGate passes GATE_SCOPE to the gate process (#820)', () => {
  it('AC-820-01: the spawn call carries an env that sets GATE_SCOPE', () => {
    // Narrow to the runTsGate body so a GATE_SCOPE mention elsewhere (the shell
    // preamble at ~line 289) cannot satisfy this by accident.
    const start = runnerSource.indexOf('function runTsGate(');
    expect(start).toBeGreaterThan(-1);
    const body = runnerSource.slice(start, runnerSource.indexOf('\nfunction ', start + 10));
    expect(body).toContain('spawnSync(');
    expect(body).toMatch(/env:\s*\{[^}]*GATE_SCOPE/);
  });

  it('AC-820-02: the value is derived from opts.scope, not from a shell string', () => {
    const start = runnerSource.indexOf('function runTsGate(');
    const body = runnerSource.slice(start, runnerSource.indexOf('\nfunction ', start + 10));
    expect(body).toMatch(/opts\.scope\s*===\s*'all'/);
    // The scope must NOT be read from process.env here: that is what the shell
    // adapters do, and copying it would pass the parent's value through even
    // when the caller asked for a diff-scoped run.
    expect(body).not.toMatch(/process\.env\.GATE_SCOPE/);
  });

  it('AC-820-03: every runTsGate caller forwards opts', () => {
    // `run: (targetPath) => runTsGate('gate-9', targetPath)` dropped the second
    // argument, so even a correct runTsGate received opts === {}. Pin all of
    // them: gate-3 is the one that already did it right and must keep doing so.
    const callSites = [...runnerSource.matchAll(/runTsGate\('([^']+)',\s*([^)]*)\)/g)].filter(
      (m) => m[1] !== 'gateModule', // exclude the declaration itself
    );
    const names = callSites.map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of ['gate-3', 'gate-7', 'gate-8', 'gate-9']) {
      expect(names).toContain(name);
    }
    for (const [full, name, rest] of callSites) {
      expect(rest.trim(), `runTsGate('${name}') must forward opts`).toMatch(/targetPath,\s*opts$/);
    }
    // And no remaining caller drops it through a one-argument lambda.
    const dropped = [...runnerSource.matchAll(/run:\s*\(targetPath\)\s*=>\s*\{\s*return runTsGate\(/g)];
    expect(dropped).toHaveLength(0);
  });
});
