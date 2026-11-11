/**
 * @test REQ-GATE-SHELL-SCOPE The baseline must measure the same shell files the gate does
 * @intent `createBaseline()` collected shell sources with `findFilesByExt(['.sh'])`,
 *         i.e. a git ls-files glob for the .sh extension. Much like the
 *         adapter's non-recursive double-star pattern, that cannot see
 *         `pre-commit` / `pre-push`, which carry no extension and are the two
 *         largest shell programs in this repository.
 *
 *         The consequence is a baseline whose denominator is smaller than the
 *         gate's: warnings inside the hooks were never recorded, so the Boy
 *         Scout comparison could only ever say "debt unchanged" no matter what
 *         those files accumulated.
 *
 * @covers AC-GATE-SHELL-SCOPE-03
 */
const path = require('path');
const { findShellScripts } = require('../baseline.js');

describe('baseline.js - shell scope', () => {
  it('AC-GATE-SHELL-SCOPE-03: includes extensionless git hooks', () => {
    const files = findShellScripts();

    // This repository always has these two, and they have no .sh suffix.
    const names = files.map(f => path.basename(f));
    expect(names).toEqual(expect.arrayContaining(['pre-commit', 'pre-push']));
  });

  it('AC-GATE-SHELL-SCOPE-03: includes ordinary .sh files', () => {
    const files = findShellScripts();
    const sh = files.filter(f => f.endsWith('.sh'));

    expect(sh.length).toBeGreaterThan(0);
  });

  it('AC-GATE-SHELL-SCOPE-03: does not include non-shell files', () => {
    const files = findShellScripts();

    for (const f of files) {
      expect(f).not.toMatch(/\.(md|json|ts|js|py)$/);
    }
  });

  it('AC-GATE-SHELL-SCOPE-03: returns an empty array outside a git work tree', () => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-shell-scope-'));
    const originalCwd = process.cwd;

    process.cwd = () => tmp;
    try {
      // Must degrade to an empty list, never throw: a baseline that crashes on
      // a non-git directory breaks every `xp-gate baseline create` run there.
      expect(() => findShellScripts()).not.toThrow();
      expect(findShellScripts()).toEqual([]);
    } finally {
      process.cwd = originalCwd;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
