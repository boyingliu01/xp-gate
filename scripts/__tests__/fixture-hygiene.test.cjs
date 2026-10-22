/**
 * AC-483-FC04 / AC-482-FC06 (Sprint B walkthrough round-1 findings):
 *
 * FC-04 — every `git commit` in a .bats fixture must carry --no-verify (or
 * pin core.hooksPath): the fixtures assert gate-script behavior, and an
 * unprotected commit on a machine with xp-gate installed runs the 12-gate
 * global suite per fixture (minutes per test, suites look hung). The sweep
 * in 63606000 was prose-audited; THIS guard makes it a permanent assertion,
 * so a future bare `git commit` in a fixture is red, not silent.
 *
 * FC-06 — the gate-4 "dead copy" qualification (githooks/gates/
 * gate-4-principles.sh has no load path) is asserted against the whole
 * install surface, not just pre-commit: shell scripts that install or wire
 * hooks must not reference it either.
 * Runs on the `npm test` (vitest) path (#484 lesson).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BATS_DIR = path.join(ROOT, 'githooks', '__tests__');

describe('FC-04: bats fixture commits never run the host hook chain', () => {
  const offenders = [];
  for (const f of fs.readdirSync(BATS_DIR)) {
    if (!f.endsWith('.bats')) continue;
    const rel = `githooks/__tests__/${f}`;
    const lines = fs.readFileSync(path.join(BATS_DIR, f), 'utf8').split('\n');
    // A `core.hooksPath` note is only an acceptable exemption when setup really
    // pins it — otherwise the annotation is a magic word that silences the
    // guard while the fixture does touch the host chain.
    const pinsHooksPath = lines.some(
      (l) => !l.trim().startsWith('#') && /git\s+config\s+core\.hooksPath/.test(l)
    );
    lines.forEach((line, i) => {
      // A real git commit invocation: `git commit` or `git -c … commit`,
      // NOT a path like .git/hooks/pre-commit (the word boundary on its own
      // would match the `git` inside `.git` and the `commit` in `pre-commit`).
      if (/(^|[^\w./-])git(\s+-\S+)*\s+commit\b/.test(line) && !line.trim().startsWith('#')) {
        if (line.includes('--no-verify')) return;
        if (line.includes('core.hooksPath') && pinsHooksPath) return;
        offenders.push(
          `${rel}:${i + 1}: ${line.trim()}` +
            (line.includes('core.hooksPath') ? '  <-- core.hooksPath claimed but never pinned in setup' : '')
        );
      }
    });
  }

  it('every fixture git commit skips hooks (53 sites swept in 63606000)', () => {
    expect(offenders).toEqual([]);
  });

  it('the sweep corpus is non-empty (anti-vacuity)', () => {
    // At least one bats file must still contain a fixture commit — if the
    // fixtures stop using git entirely this guard must not pretend to guard.
    let filesWithCommits = 0;
    for (const f of fs.readdirSync(BATS_DIR)) {
      if (f.endsWith('.bats') && /git commit/.test(fs.readFileSync(path.join(BATS_DIR, f), 'utf8'))) {
        filesWithCommits++;
      }
    }
    expect(filesWithCommits).toBeGreaterThan(0);
  });
});

describe('FC-06: the gate-4 dead copy stays dead across the whole install surface', () => {
  const DEAD = 'gate-4-principles.sh';
  // Every script that could wire a hook into a repo or install hook copies.
  const INSTALL_SURFACES = [
    'githooks/pre-commit',
    'githooks/pre-push',
    'scripts/install-all.sh',
    'scripts/install-pre-commit.sh',
    'scripts/install-pre-push.sh',
    'scripts/install-sprint-flow.sh',
  ].filter((p) => fs.existsSync(path.join(ROOT, p)));

  it('no installer or hook wires gate-4-principles.sh', () => {
    const live = [];
    for (const p of INSTALL_SURFACES) {
      const text = fs.readFileSync(path.join(ROOT, p), 'utf8');
      if (text.includes(DEAD)) live.push(p);
    }
    expect(live).toEqual([]);
  });

  it('the install surface is non-empty (anti-vacuity)', () => {
    expect(INSTALL_SURFACES.length).toBeGreaterThanOrEqual(3);
  });
});
