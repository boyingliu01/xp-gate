/**
 * @test REQ-720
 * @intent Every `gate-*.sh` that also exists under `githooks/adapters/` must be a
 *          byte-identical copy of its canonical `githooks/gate-*.sh`.
 *
 *          `githooks/adapters/gate-9.sh` is NOT dead weight: it is the TS-less
 *          fallback `resolveGateScript(9)` returns, and its verdict block is
 *          pinned byte-for-byte across three copies by #532. But #683 measured
 *          four of the five adapters copies lagging the canonical gate —
 *          `gate-3.sh` by 4953 bytes, missing the #632 fix outright.
 *
 *          Nothing failed, because the published package happens to overwrite
 *          `adapters/gate-N.sh` with the package-root copy, which is regenerated
 *          from `githooks/` on every sync. That is copy ORDER, not correctness:
 *          the stale file still ships, still sits in the tree, and still wins for
 *          any consumer that reads `adapters/` directly — or for
 *          `resolveGateScript()`'s `~/.config/xp-gate/adapters/gate-N.sh` probe
 *          if the package-root copy were ever absent.
 *
 *          A stale mirror that is merely overwritten downstream is
 *          indistinguishable from a correct one until the order changes. So the
 *          mirror is asserted directly.
 * @covers AC-720-01, AC-720-02, AC-720-03
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GITHOOKS = path.join(REPO_ROOT, 'githooks');
const ADAPTERS = path.join(GITHOOKS, 'adapters');

/** Gate script names present under `githooks/adapters/`. */
function adaptersGateNames() {
  let entries;
  try {
    entries = fs.readdirSync(ADAPTERS);
  } catch {
    return [];
  }
  return entries.filter(
    (f) => f.endsWith('.sh') && (f.startsWith('gate-') || f === 'sprint-gate.sh'),
  ).sort();
}

describe('REQ-720 adapter gate copies are mirrors of the canonical gates', () => {
  it('AC-720-01: the adapter gate copies exist at all (anti-vacuity)', () => {
    // If this list is empty the parity assertions below would pass vacuously —
    // exactly the failure shape #683 is about.
    //
    // This used to pin `gate-9.sh`, which P1-B deleted: it carried a "DEAD CODE —
    // NOT EXECUTED" banner, no hook sourced it, and the real SAST gate is
    // gate-10.sh. The assertion was not updated then, so it went on naming a file
    // that no longer existed — an anti-vacuity check that had itself become
    // vacuous, in the opposite direction from the one it was written to catch.
    // Pinning the set that actually ships is what makes it an oracle again.
    // The expectation is DERIVED from the canonical tree, not typed out. The
    // previous version pinned the literal set ['gate-3.sh','gate-4.sh',
    // 'gate-7.sh','gate-8.sh'] and went stale the moment three more gate copies
    // shipped (gate-10, gate-12-file-hygiene, gate-13-compiler-strictness,
    // gate-6-layers), failing on every run for a reason unrelated to parity --
    // the same rot, in the same assertion, that the comment above already
    // describes once. Deriving it keeps the anti-vacuity guarantee (a missing
    // mirror still fails) without needing an edit each time a gate is added.
    const names = adaptersGateNames();
    expect(names.length).toBeGreaterThan(0);

    // A gate body that ships canonically must have a mirror. The mirrored set is
    // exactly `gate-*.sh` MINUS the chain files: gate-driver.sh/gate-registry.sh
    // are the order and the name→file binding, and sprint-gate.sh is hook-side
    // only -- none of the three is a gate body, and none has ever been mirrored
    // into adapters/.
    const isMirrored = (f) =>
      f.endsWith('.sh') &&
      f.startsWith('gate-') &&
      f !== 'gate-driver.sh' &&
      f !== 'gate-registry.sh';
    const canonicalNames = fs.readdirSync(GITHOOKS).filter(isMirrored).sort();
    expect(names.length, 'no gate bodies mirrored — the parity check would be vacuous').toBeGreaterThan(0);
    expect(canonicalNames.filter((n) => !names.includes(n))).toEqual([]);
  });

  it('AC-720-02: every adapter gate copy is byte-identical to githooks/<name>', () => {
    const drifted = [];
    for (const name of adaptersGateNames()) {
      const canonical = path.join(GITHOOKS, name);
      const mirror = path.join(ADAPTERS, name);
      if (!fs.existsSync(canonical)) {
        drifted.push(`${name}: no canonical githooks/${name} to mirror`);
        continue;
      }
      const a = fs.readFileSync(canonical);
      const b = fs.readFileSync(mirror);
      if (!a.equals(b)) {
        drifted.push(`${name}: adapters copy is ${b.length}B, canonical is ${a.length}B`);
      }
    }
    expect(drifted).toEqual([]);
  });

  it('AC-720-03: the npm package mirrors every adapter, gate copies included', () => {
    // The package's adapters/ is what `copyAdapters()` reads, so a drift there
    // is the drift users install.
    const pkgAdapters = path.join(REPO_ROOT, 'src', 'npm-package', 'adapters');
    const drifted = [];
    for (const name of adaptersGateNames()) {
      const src = path.join(ADAPTERS, name);
      const dest = path.join(pkgAdapters, name);
      if (!fs.existsSync(dest)) {
        drifted.push(`${name}: missing from src/npm-package/adapters/`);
        continue;
      }
      if (!fs.readFileSync(src).equals(fs.readFileSync(dest))) {
        drifted.push(`${name}: npm package adapter copy differs from githooks/adapters/`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
