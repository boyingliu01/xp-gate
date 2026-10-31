/**
 * @test REQ-CCNRPT-002
 * @intent #617 turned `.ccn-baseline.json` into `{ population, entries }` so the
 *         ratchet could declare what it covers. The reader was never updated: the
 *         whole document was handed to the comparison, so `baseline["<file>::<fn>"]`
 *         was ALWAYS undefined.
 *
 *         The failure mode is the dangerous one. The ratchet held 976 entries of
 *         accepted debt and could consult none of them, so every function above the
 *         block threshold was reported as "new code". CI then failed on eight
 *         functions whose CCN matched their recorded value EXACTLY -- and because the
 *         message said "new function", the obvious reading was "someone added eight
 *         complex functions", which was false.
 *
 *         A baseline that is never consulted is indistinguishable from no baseline,
 *         except that it looks like one. These cases pin the contract from both ends:
 *         a recorded function must pass, and an UNRECORDED one must still block. A
 *         guard that only proves the first half would pass with the ratchet disabled.
 * @covers AC-617-04
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const reportPath = path.resolve(__dirname, '..', 'ccn-report.cjs');

/** lizard must exist for these cases: they measure real CCN values. */
function hasLizard() {
  return spawnSync('lizard', ['--version'], { encoding: 'utf8' }).status === 0;
}

/**
 * A source file whose only function sits above the block threshold (default 10).
 *
 * Ten `if`s plus the base path gives CCN 11. Written as a flat sequence so the count
 * is obvious to a reader and stable across lizard versions.
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
 * Build a throwaway project: one complex source file plus a baseline for it.
 *
 * @param {boolean} recordIt whether the baseline records the function's real CCN
 * @returns {{ dir: string, baselinePath: string }}
 */
function makeProject(recordIt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-ccn-'));
  fs.writeFileSync(path.join(dir, 'branchy.cjs'), COMPLEX_SOURCE);

  const entries = recordIt ? { 'branchy.cjs::branchy': 11 } : {};
  const baselinePath = path.join(dir, '.ccn-baseline.json');
  // The post-#617 shape. The fix must read this, not the legacy flat map.
  fs.writeFileSync(baselinePath, JSON.stringify({ population: { roots: ['.'] }, entries }, null, 2));
  return { dir, baselinePath };
}

function runCheck(dir, baselinePath) {
  return spawnSync(
    process.execPath,
    [reportPath, '--check', '--root', dir, '--baseline', baselinePath, '--block', '10'],
    { encoding: 'utf8', timeout: 120000 },
  );
}

const describeIfLizard = hasLizard() ? describe : describe.skip;

describeIfLizard('ccn ratchet 读取 { population, entries } 基线 (#617)', () => {
  it('AC-617-04: a recorded function at its recorded CCN is NOT reported as new', () => {
    const { dir, baselinePath } = makeProject(true);
    try {
      const result = runCheck(dir, baselinePath);
      expect(result.stdout).not.toMatch(/new function over block threshold/);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-617-04: an unrecorded function over the block threshold still blocks', () => {
    // The half that keeps the first one honest: if the fix had simply returned an
    // empty baseline, the case above would pass and the ratchet would be dead.
    const { dir, baselinePath } = makeProject(false);
    try {
      const result = runCheck(dir, baselinePath);
      expect(result.stdout).toMatch(/new function over block threshold/);
      expect(result.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
