/**
 * @test REQ-CCNRPT-002
 * @intent The CCN ratchet is a comparison: a recorded ceiling against today's
 *         measurement. That comparison is only sound when ONE analyzer took both
 *         numbers, and nothing enforced that. `checkLizardVersion` accepted any
 *         1.x release, so a developer machine on lizard 1.25.0 graded itself
 *         against a baseline written by 1.21.3.
 *
 *         Measured on this repo before the fix: 1.21.3 and 1.25.0 disagree about
 *         `src/principles/adapters/csharp.ts::extractFunctions` by 9 vs 18, and
 *         each version reported its own disjoint set of "violations" — 1.25.0
 *         flagged `scripts/ccn-report.cjs` anonymous callbacks, 1.21.3 flagged
 *         `typescript.ts::get imports`. Neither set had anything to do with a code
 *         change, and the only way to clear them was `--write-baseline`, which
 *         inflates the ceiling to whichever analyzer ran last. The gate would then
 *         be blind to the regressions it exists to catch.
 *
 *         The pin in `.lizard-version` only helps CI; a local run was free to
 *         grade against a different analyzer and had no way to notice. Recording
 *         the exact version in the baseline is what makes the mismatch detectable.
 * @covers AC-GATE3-ANALYZER
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const reportPath = path.resolve(__dirname, '..', 'ccn-report.cjs');

/**
 * The lizard version the local `lizard` command reports, or null.
 *
 * The cases below need a REAL version string to write into the baseline; a
 * hard-coded one would test the string comparison against a version that may not
 * be installed, and the "matches" case would never be reachable.
 *
 * Probing once answers both questions this file needs: whether lizard is
 * installed, and which version it is. A separate `hasLizard()` used to spawn
 * `lizard --version` a second time for the first question alone; on this machine
 * that probe measured 690-895 ms, and "is lizard installed" cannot change mid-run.
 */
function currentLizardVersion() {
  const result = spawnSync('lizard', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const m = String(result.stdout).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? m[0] : null;
}

/**
 * A source file whose only function sits above the block threshold (default 10).
 * Ten `if`s plus the base path gives CCN 11.
 */
const COMPLEX_SOURCE = [
  'function branchy(x) {',
  ...Array.from({ length: 10 }, (_, i) => `  if (x === ${i}) return ${i};`),
  '  return -1;',
  '}',
  'module.exports = { branchy };',
  '',
].join('\n');

/**
 * Build a throwaway project whose baseline records `branchy` at its real CCN,
 * stamped with the given analyzer version.
 *
 * @param {string|null} analyzerVersion version to record, or null to omit the block
 * @returns {{ dir: string, baselinePath: string }}
 */
function makeProject(analyzerVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-ccn-analyzer-'));
  fs.writeFileSync(path.join(dir, 'branchy.cjs'), COMPLEX_SOURCE);

  const document = { population: { roots: ['.'] }, entries: { 'branchy.cjs::branchy': 11 } };
  if (analyzerVersion !== null) {
    document.analyzer = { tool: 'lizard', version: analyzerVersion };
  }
  const baselinePath = path.join(dir, '.ccn-baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify(document, null, 2));
  return { dir, baselinePath };
}

function runCheck(baselinePath) {
  return spawnSync(
    process.execPath,
    [reportPath, '--check', '--baseline', baselinePath, '--block', '10'],
    { encoding: 'utf8', timeout: 120000, cwd: path.dirname(baselinePath) },
  );
}

// One probe answers both "is lizard available" and "which version": a null
// version already means the analyzer is absent.
const version = currentLizardVersion();
const describeIfLizard = version === null ? describe.skip : describe;

describeIfLizard('ccn ratchet refuses to compare across analyzer versions', () => {
  it('AC-GATE3-ANALYZER: a baseline recording the SAME version is compared normally', () => {
    // The half that keeps the mismatch case honest: a guard that always refused
    // would also "pass" the rejection test while making the gate unusable.
    const { dir, baselinePath } = makeProject(version);
    try {
      const result = runCheck(baselinePath);
      expect(result.stderr).not.toMatch(/was written by lizard/);
      expect(result.stdout).toMatch(/OK — .* within the ratchet/);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-GATE3-ANALYZER: a baseline recording a DIFFERENT version is refused, not graded', () => {
    // Derived from the installed version so it can never coincide with it: a
    // hard-coded "9.9.9" would pass this case even if the comparison were on the
    // major digit only.
    const mismatched = version === '0.0.1' ? '0.0.2' : '0.0.1';
    const { dir, baselinePath } = makeProject(mismatched);
    try {
      const result = runCheck(baselinePath);
      expect(result.stderr).toMatch(new RegExp(`was written by lizard ${mismatched.replace(/\./g, '\\.')}`));
      expect(result.stderr).toMatch(/different lizard releases disagree/i);
      // Refusing means naming the repair, not just failing.
      expect(result.stderr).toMatch(/pip install lizard==/);
      // Crucially it must NOT report debt: a false BLOCK is what sent the last
      // investigation down a code-archaeology path that had no defect at the end.
      expect(result.stdout).not.toMatch(/BLOCK /);
      expect(result.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-GATE3-ANALYZER: a baseline with no analyzer block still grades, with a warning', () => {
    // Every baseline written before this change looks like this. Rejecting them
    // outright would turn a missing record into an outage on every branch; the
    // warning is what asks for the record without blocking work.
    const { dir, baselinePath } = makeProject(null);
    try {
      const result = runCheck(baselinePath);
      expect(result.stderr).toMatch(/does not record which lizard wrote it/);
      expect(result.stdout).toMatch(/OK — .* within the ratchet/);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-GATE3-ANALYZER: --write-baseline records the analyzer version it used', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-ccn-write-'));
    try {
      fs.writeFileSync(path.join(dir, 'branchy.cjs'), COMPLEX_SOURCE);
      const result = spawnSync(
        process.execPath,
        [reportPath, '--write-baseline', '--root', dir, '--block', '10'],
        { encoding: 'utf8', timeout: 120000 },
      );
      expect(result.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(path.join(dir, '.ccn-baseline.json'), 'utf8'));
      expect(written.analyzer).toEqual({ tool: 'lizard', version });
      // The entry must still be written; recording provenance must not replace
      // the measurement it describes.
      expect(written.entries['branchy.cjs::branchy']).toBe(11);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
