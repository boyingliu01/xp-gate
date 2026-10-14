/**
 * AC-482 (issue #482): Gate 4 has three near-duplicate scripts. Audit result
 * (this guard IS the disposition record — the issue demanded an explicit
 * qualification, not a silent fork):
 *
 *   githooks/gate-4.sh              — canonical, sourced by pre-commit when
 *                                     GATE_DIR resolves in-repo. NO --config:
 *                                     relies on the principles tool's cwd
 *                                     discovery of .principlesrc.
 *   githooks/adapters/gate-4.sh     — REACHABLE: byte-shipped to
 *                                     ~/.config/xp-gate/adapters/ and sourced
 *                                     there when the global layout wins.
 *                                     Same cwd-discovery semantics.
 *   githooks/gates/gate-4-principles.sh — DEAD copy: nothing sources it (only
 *                                     the installed README names it). It
 *                                     carries the #457-era ARRAY-form
 *                                     --config pointing at the git toplevel,
 *                                     an older/experimental resolution the
 *                                     live copies do not use.
 *
 * Invariants pinned below (cheap, vs. a dedup refactor that belongs to the
 * Sprint E cleanup line): (1) the LIVE copies must never grow an UNQUOTED
 * string --config (the word-splitting bug class #457 fixed); (2) the dead
 * copy, while it still exists, keeps its array form; (3) a dead copy must
 * not silently become live — any new source of gate-4-principles.sh is a
 * deliberate act that must update this guard.
 * Runs on the `npm test` (vitest) path (#484 lesson).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AC-482: gate-4 copy landscape stays qualified (#482)', () => {
  it('the two LIVE copies never grow an unquoted string --config', () => {
    for (const copy of ['githooks/gate-4.sh', 'githooks/adapters/gate-4.sh']) {
      const text = read(copy);
      // A live copy may adopt --config, but only in bash-array form (the
      // #457 quoting contract). A bare string assignment like
      // PRINCIPLES_CONFIG="--config $X" reintroduces word splitting on
      // paths with spaces.
      expect(text).not.toMatch(/PRINCIPLES_CONFIG\s*=\s*["']--config/);
      // And if --config is actually USED in an argv, it must be array-quoted.
      const used = text.match(/^\s*(?:\S+\s+)*\$\{PRINCIPLES_CONFIG\[@\]/m);
      if (used) {
        expect(text).toMatch(/PRINCIPLES_CONFIG=\(/);
      }
    }
  });

  it('the DEAD copy keeps its array-form --config while it exists', () => {
    const p = path.join(ROOT, 'githooks/gates/gate-4-principles.sh');
    if (!fs.existsSync(p)) return; // deleted by the Sprint E cleanup — fine
    const text = fs.readFileSync(p, 'utf8');
    expect(text).toMatch(/PRINCIPLES_CONFIG=\(/);
    expect(text).toMatch(/PRINCIPLES_CONFIG=\(--config "\$PRINCIPLES_ROOT\/\.principlesrc"\)/);
  });

  it('gate-4-principles.sh stays dead unless this guard is updated (anti-resurrection)', () => {
    const hook = read('githooks/pre-commit');
    expect(hook).not.toMatch(/gate-4-principles\.sh/);
    // The npm mirror is checked separately by the byte-parity guards; this
    // pins only the load path.
  });

  it('the live copies keep the principles tool invocation contract', () => {
    // Both live copies must call the same tool entrypoint with JSON output —
    // the verdict parsing downstream depends on --format json.
    for (const copy of ['githooks/gate-4.sh', 'githooks/adapters/gate-4.sh']) {
      const text = read(copy);
      expect(text).toMatch(/index\.ts/);
      expect(text).toMatch(/--format json/);
    }
  });
});
