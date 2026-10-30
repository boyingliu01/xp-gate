/**
 * @test REQ-605
 * @intent `gate-coverage` used to announce a COVERAGE THRESHOLD CONFLICT in this
 *         repo that did not exist: "pre-commit enforces 80% while vitest.config.ts
 *         enforces 70%".
 *
 *         The hook was actually enforcing 70 — it RESOLVES the number at runtime
 *         from `vitest.config.ts` (#605's own fix). The reporter read the hook's
 *         SOURCE and matched the first `COVERAGE_THRESHOLD` number it could find,
 *         which is `${COVERAGE_THRESHOLD:-80}` inside a *log message*. That literal
 *         renders only when the variable is empty, which the defensive guard above
 *         it prevents.
 *
 *         A false conflict is worse than no conflict: it sends someone to change a
 *         declaration that is already correct, and it teaches them to distrust the
 *         report. These tests pin the distinction between "a number appears in the
 *         hook file" and "the hook enforces that number".
 * @covers AC-605-07
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readHookCoverageFloor } = require('../gate-coverage.js');

/** Write a throwaway repo root holding `githooks/pre-commit` with `body`. */
function repoWithHook(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-hookfloor-'));
  fs.mkdirSync(path.join(root, 'githooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'githooks', 'pre-commit'), body);
  return root;
}

describe('pre-commit coverage floor 读取 (#605)', () => {
  it('AC-605-07: a message template is not mistaken for the enforced floor', () => {
    const root = repoWithHook([
      '#!/usr/bin/env bash',
      'echo "below ${COVERAGE_THRESHOLD:-80}% threshold"',
    ].join('\n'));
    try {
      // This is the exact line that produced the phantom 80.
      expect(readHookCoverageFloor(root)).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC-605-07: the defensive guard fallback alone reports "no declared floor"', () => {
    const root = repoWithHook([
      '#!/usr/bin/env bash',
      'if ! [[ "${COVERAGE_THRESHOLD:-}" =~ ^[0-9]+$ ]]; then',
      '  COVERAGE_THRESHOLD=80',
      'fi',
    ].join('\n'));
    try {
      // The guard fires only when nothing was declared; when a project DOES declare
      // a threshold the hook uses that, so reporting 80 here would invert reality.
      expect(readHookCoverageFloor(root)).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC-605-07: a genuinely assigned non-default floor is reported', () => {
    const root = repoWithHook([
      '#!/usr/bin/env bash',
      'COVERAGE_THRESHOLD=72',
      'if [ "$pct" -lt "$COVERAGE_THRESHOLD" ]; then echo blocked; fi',
    ].join('\n'));
    try {
      expect(readHookCoverageFloor(root)).toBe(72);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC-605-07: a hook with no threshold at all reports null, not a default', () => {
    const root = repoWithHook('#!/usr/bin/env bash\necho hello\n');
    try {
      expect(readHookCoverageFloor(root)).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC-605-07: the real repo hook does not claim a floor it does not enforce', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    // The real hook resolves from vitest.config.ts, so it declares no literal.
    // Asserting null here is the regression guard for the phantom-conflict report.
    expect(readHookCoverageFloor(repoRoot)).toBeNull();
  });
});
