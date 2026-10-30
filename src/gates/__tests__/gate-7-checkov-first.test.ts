/**
 * @test REQ-650
 * @intent `xp-gate check . --gates 7` reported "IaC adapter not found" / SKIP on a
 *         project with a staged Dockerfile, even with checkov installed and on
 *         PATH. The original report was worse still -- the adapter's own preamble
 *         text was echoed and 0/1 gates "passed" -- but the residual defect is
 *         the ordering: findIaCAdapter() is consulted BEFORE checkov, so any
 *         consumer project without a vendored `githooks/adapters/iac.sh` SKIPs a
 *         gate it could have run. A security gate that skips because a helper
 *         script is absent, while the real scanner is installed, is the
 *         "no evidence reported as fine" class this project bans.
 *
 *         checkov is the preferred engine (the module's own comment says so); the
 *         bash adapter is the FALLBACK. So checkov must be tried first.
 * @covers AC-650-01, AC-650-02, AC-650-03
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GATE7 = path.join(REPO_ROOT, 'src', 'gates', 'gate-7.ts');
const GATE7_MIRROR = path.join(REPO_ROOT, 'src', 'npm-package', 'gates', 'gate-7.ts');

describe('Gate 7 prefers checkov over the optional bash adapter (#650)', () => {
  it('AC-650-01: does not return SKIP before checkov has been considered', () => {
    const src = fs.readFileSync(GATE7, 'utf8');
    const checkovAt = src.indexOf("isToolAvailable('checkov'");
    const adapterAt = src.indexOf('findIaCAdapter(');
    expect(checkovAt).toBeGreaterThan(-1);
    expect(adapterAt).toBeGreaterThan(-1);
    // checkov is consulted first; the adapter lookup must come after it.
    expect(checkovAt).toBeLessThan(adapterAt);
  });

  it('AC-650-02: a missing adapter is not a SKIP when checkov is installed', () => {
    const src = fs.readFileSync(GATE7, 'utf8');
    // The "adapter not found" SKIP must sit inside a branch that has already
    // established checkov is unavailable.
    const skipAt = src.indexOf('IaC adapter not found');
    expect(skipAt).toBeGreaterThan(-1);
    const before = src.slice(0, skipAt);
    expect(before).toMatch(/checkov[\s\S]*available/);
  });

  it('AC-650-03: the shipped package mirror matches the canonical module', () => {
    if (!fs.existsSync(GATE7_MIRROR)) return; // mirror is generated at prepack
    expect(fs.readFileSync(GATE7_MIRROR, 'utf8')).toBe(fs.readFileSync(GATE7, 'utf8'));
  });
});
