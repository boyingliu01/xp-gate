/**
 * @test REQ-2 xp-gate doctor
 * @intent Prove that the SHIPPED hook files still carry the exact signature
 *         strings doctor uses to decide "this file is an xp-gate hook".
 * @covers AC-05, AC-10
 *
 * Why this exists (#599): doctor identifies an installed hook by substring
 * (`SIGNATURES`). The signatures are prose taken from each hook's own banner, so
 * an innocuous editorial change to a banner line — replacing the em dash in
 * `# Pre-push Hook — 8 gates:` with an ASCII hyphen, say — silently makes every
 * installed pre-push hook unrecognisable. doctor then reports
 * `Hooks: pre-push: Missing or not xp-gate` on a perfectly healthy install and
 * `--fix` cannot clear it, because there is nothing wrong to fix.
 *
 * That is exactly what happened while rewriting the CRLF self-check in #546: the
 * banner was retyped, the dash changed, and 9 doctor `--fix` cases went red with
 * "expected 1 to be +0" — an assertion far from the actual cause. This test
 * turns that class of failure into a one-line diagnostic naming the file and the
 * missing string.
 */
const fs = require('fs');
const path = require('path');

describe('shipped hooks carry doctor SIGNATURES', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const { SIGNATURES } = require('../doctor');

  // The hook files that this repository actually ships, in both mirrors.
  const SHIPPED_HOOKS = [
    { sig: 'pre-commit', file: 'githooks/pre-commit' },
    { sig: 'pre-commit', file: 'src/npm-package/hooks/pre-commit' },
    { sig: 'pre-push', file: 'githooks/pre-push' },
    { sig: 'pre-push', file: 'src/npm-package/hooks/pre-push' },
  ];

  for (const { sig, file } of SHIPPED_HOOKS) {
    it(`${file} contains SIGNATURES['${sig}']`, () => {
      const abs = path.join(repoRoot, file);
      expect(fs.existsSync(abs), `${file} does not exist`).toBe(true);
      const content = fs.readFileSync(abs, 'utf8');

      expect(
        content.includes(SIGNATURES[sig]),
        `${file} does not contain ${JSON.stringify(SIGNATURES[sig])}.\n`
          + 'doctor identifies an xp-gate hook by this exact substring, so an '
          + 'edit to the banner line silently makes every installed hook look '
          + 'foreign. Restore the string, or update SIGNATURES in doctor.js in '
          + 'the same commit (and keep the mirrors byte-identical).'
      ).toBe(true);
    });
  }

  it('the two hook mirrors are byte-identical', () => {
    for (const name of ['pre-commit', 'pre-push']) {
      const a = path.join(repoRoot, 'githooks', name);
      const b = path.join(repoRoot, 'src/npm-package/hooks', name);
      expect(fs.existsSync(a), a).toBe(true);
      expect(fs.existsSync(b), b).toBe(true);
      expect(
        fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8'),
        `githooks/${name} and src/npm-package/hooks/${name} differ`
      ).toBe(true);
    }
  });
});
