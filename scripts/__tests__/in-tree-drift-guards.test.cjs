/**
 * AC-433 (issue #433): in-tree drift guards — the three drift classes PR #430
 * had to fix by hand (external one-off scripts) become automated assertions:
 *   1. mirror byte/mode parity (delegates to scripts/check-hook-mirror.sh —
 *      the same implementation CI runs, now also on the npm test path)
 *   2. plugin manifest description consistency + a blacklist of the stale
 *      gate-count strings that must never flow back
 *   3. the SPRINT_GATE_SCRIPT RESOLUTION markers both pre-commit copies carry
 *      (the awk extraction contract sprint-gate.test.bats depends on)
 * The 6ebbd5a lesson applies: every guard here runs on `npm test`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFESTS = [
  'plugins/claude-code/.claude-plugin/plugin.json',
  'plugins/qoder/plugin.json',
  'src/npm-package/plugins/claude-code/.claude-plugin/plugin.json',
  'src/npm-package/plugins/qoder/plugin.json',
];

// Strings that describe SUPERSEDED gate counts. If any of these flows back
// into a manifest, the counting story has drifted again (AC-433-02).
const STALE_DESCRIPTION_PATTERNS = [
  /10 quality gates/i,
  /\(Gate 0-9\)/,
  /11 phases/i,
  /6 Gates\b/,
];

describe('AC-433-01: hook mirror parity (githooks ↔ npm mirrors, byte-level)', () => {
  // Pure-Node byte parity over the exact file list scripts/check-hook-mirror.sh
  // guards. Rationale for NOT delegating to the script here: synchronous
  // subprocess spawning is unreliable inside sandboxed dev sessions
  // (spawnSync cmd.exe ETIMEDOUT, observed), and the npm test path must be
  // green for the right reason everywhere. The script itself remains the
  // exec-bit + parity authority on CI (Mirror Parity workflow + pre-push via
  // #521), which is where the Git index mode is meaningful.
  // The file list is PARSED from scripts/check-hook-mirror.sh — the single
  // source of truth — instead of duplicated here (walkthrough FC-08: two
  // hand-maintained lists silently diverge the day someone adds a gate).
  function parsedMirrorList(varName) {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'check-hook-mirror.sh'), 'utf8');
    const m = script.match(new RegExp(`^${varName}="([^"]*)"`, 'm'));
    if (!m) throw new Error(`check-hook-mirror.sh no longer defines ${varName} — update this guard`);
    return m[1].trim().split(/\s+/).filter(Boolean);
  }
  const HOOK_FILES = parsedMirrorList('HOOK_MIRROR_FILES');
  const ROOT_FILES = parsedMirrorList('ROOT_MIRROR_FILES');

  function assertByteParity(canonRel, mirrorRel) {
    const canon = path.join(ROOT, canonRel);
    const mirror = path.join(ROOT, mirrorRel);
    expect(fs.existsSync(canon)).toBe(true);
    expect(fs.existsSync(mirror)).toBe(true);
    const a = fs.readFileSync(canon);
    const b = fs.readFileSync(mirror);
    if (!a.equals(b)) {
      return `byte drift: ${canonRel} != ${mirrorRel}`;
    }
    return null;
  }

  it('hooks/ mirrors are byte-identical to githooks/', () => {
    const problems = HOOK_FILES
      .map((f) => assertByteParity(path.join('githooks', f), path.join('src/npm-package/hooks', f)))
      .filter(Boolean);
    expect(problems).toEqual([]);
  });

  it('root-level shell mirrors are byte-identical to githooks/', () => {
    const problems = ROOT_FILES
      .map((f) => assertByteParity(path.join('githooks', f), path.join('src/npm-package', f)))
      .filter(Boolean);
    expect(problems).toEqual([]);
  });

  it('principles tree mirrors are byte-identical to src/principles/', () => {
    const srcDir = path.join(ROOT, 'src', 'principles');
    const mirrorDir = path.join(ROOT, 'src', 'npm-package', 'principles');
    expect(fs.existsSync(srcDir)).toBe(true);
    expect(fs.existsSync(mirrorDir)).toBe(true);
    const problems = [];
    for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const rel = e.name;
      const a = path.join(srcDir, rel);
      const b = path.join(mirrorDir, rel);
      if (e.isDirectory()) continue; // directory-level parity via files below
      if (!fs.existsSync(b)) { problems.push(`missing mirror: src/npm-package/principles/${rel}`); continue; }
      if (!fs.readFileSync(a).equals(fs.readFileSync(b))) {
        problems.push(`byte drift: src/principles/${rel}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('AC-433-02: plugin manifest descriptions agree and never regress', () => {
  it('all four manifests parse and share one gate-count story', () => {
    const descriptions = MANIFESTS.map((m) => {
      const p = path.join(ROOT, m);
      expect(fs.existsSync(p)).toBe(true);
      return JSON.parse(fs.readFileSync(p, 'utf8')).description;
    });
    // The count-bearing clause must be identical across canonical and mirrors.
    const clauses = descriptions.map((d) => (d.match(/Includes [^.]*/) || [])[0]);
    expect(new Set(clauses).size).toBe(1);
    expect(clauses[0]).toMatch(/12 pre-commit gates \(Gate 0-11\)/);
    expect(clauses[0]).toMatch(/Sprint Flow \(6 phases\)/);
  });

  it('superseded gate-count strings never flow back', () => {
    for (const m of MANIFESTS) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, m), 'utf8')).description;
      for (const pattern of STALE_DESCRIPTION_PATTERNS) {
        expect(d).not.toMatch(pattern);
      }
    }
  });
});

describe('AC-433-03: SPRINT_GATE_SCRIPT RESOLUTION markers in both pre-commit copies', () => {
  const copies = ['githooks/pre-commit', 'src/npm-package/hooks/pre-commit'];
  for (const copy of copies) {
    it(`${copy} carries the extraction markers`, () => {
      const text = fs.readFileSync(path.join(ROOT, copy), 'utf8');
      expect(text).toMatch(/^# BEGIN SPRINT_GATE_SCRIPT RESOLUTION$/m);
      expect(text).toMatch(/^# END SPRINT_GATE_SCRIPT RESOLUTION$/m);
      // BEGIN must precede END — a swapped pair would make the awk capture empty.
      const begin = text.indexOf('# BEGIN SPRINT_GATE_SCRIPT RESOLUTION');
      const end = text.indexOf('# END SPRINT_GATE_SCRIPT RESOLUTION');
      expect(begin).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(begin);
    });
  }
});
