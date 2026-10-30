/**
 * @test gates-shipped
 * @intent Guard #658: the test-layers / pbt / python-health gate modules must be bundled into the npm package — 'gates/' declared in files[], the local mirror generated from src/gates at prepack, and the mirror gitignored (never tracked, so archlint CodeClone does not fire on duplicated test files)
 * @covers AC-DSH-019
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_GATES = path.join(REPO_ROOT, 'src', 'gates');
const PKG_ROOT = path.join(REPO_ROOT, 'src', 'npm-package');
const PKG_GATES = path.join(PKG_ROOT, 'gates');

describe('gates/ ships in the npm package (#658)', () => {
  it("declares 'gates/' in package.json files[]", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('gates/');
  });

  it('has a generated mirror for every non-test src/gates module', () => {
    // The mirror is produced by sync-package-content.js (prepack). It may or may
    // not be present in a fresh clone, but when present it must be complete.
    const modules = fs
      .readdirSync(SRC_GATES)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(modules.length).toBeGreaterThan(0);
    if (!fs.existsSync(PKG_GATES)) return; // fresh clone: nothing generated yet
    const missing = modules.filter((f) => !fs.existsSync(path.join(PKG_GATES, f)));
    expect(missing).toEqual([]);
  });

  it('includes the three gates #658 was filed about (when generated)', () => {
    if (!fs.existsSync(PKG_GATES)) return;
    for (const f of ['test-layers.ts', 'pbt-detect.ts', 'python-health.ts']) {
      expect(fs.existsSync(path.join(PKG_GATES, f))).toBe(true);
    }
  });

  it('does not ship a top-level test file or include __tests__ in files[]', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    expect(pkg.files.some((f) => f.includes('__tests__'))).toBe(false);
    if (!fs.existsSync(PKG_GATES)) return;
    const strayTests = fs.readdirSync(PKG_GATES).filter((f) => /\.test\.ts$/.test(f));
    expect(strayTests).toEqual([]);
  });

  it('gitignores the mirror so its duplicated test files never get tracked', () => {
    // Tracked byte-identical __tests__ under both src/gates and the mirror tripped
    // archlint CodeClone. The mirror is a prepack artifact; keep it untracked.
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^src\/npm-package\/gates\/$/m);
  });
});
