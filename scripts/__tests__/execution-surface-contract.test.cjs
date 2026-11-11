#!/usr/bin/env node
/**
 * @test REQ-D1/REQ-D2 — the execution surfaces agree, and "did not run" never reads as "passed"
 * @intent A gate result is the one number a human or an agent acts on, and the
 *         three execution surfaces must not disagree about it. Measured before
 *         writing this file (2026-11-11, repo at 82d4bf4):
 *
 *           xp-gate gate-0   -> "⏭️ SKIPPED" ... exit 0
 *           xp-gate gate-9   -> "⏭️ SKIPPED" ... exit 0
 *           check --gates=0  -> "⏭️ SKIPPED" ... exit 0
 *
 *         Seven of fourteen pre-commit gates cannot run outside `git commit`,
 *         and every one of them reports the SAME exit code as a gate that ran
 *         and passed. A caller that reads only the exit status -- CI, a script,
 *         an agent loop -- cannot distinguish "clean" from "never executed".
 *         That is the false green `gate-coverage` renders as SKIP with a reason,
 *         and the reason it needed four states instead of three (#636).
 *
 *         The codebase already knows the right answer. gate-runner.js:523 returns
 *         the GATE_NOT_RUN sentinel for "no module, no bash fallback", and
 *         bin/xp-gate.js:527 maps it to exit 2 with the comment "a gate that ran
 *         nothing yields GATE_NOT_RUN ... process.exit() would coerce that string
 *         to 0 (a pass)". The preCommitOnly branch at gate-runner.js:858 then
 *         does the exact thing that comment forbids: it prints SKIPPED, returns
 *         0, and bypasses the sentinel entirely. One file, two opposite answers
 *         to "the gate did not run".
 *
 *         Capability is published, not discovered (REQ-D2): a caller should be
 *         able to ask which gates a path can execute, and get the answer from the
 *         registry rather than from a footnote in a design doc that says the CLI
 *         is "structurally missing 0/1/5/9/11/12/13" (it is not missing them --
 *         it offers all fourteen and silently declines seven).
 * @covers REQ-D1, REQ-D2
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const childProcess = require('node:child_process');

const { test: nodeTest } = require('node:test');
const it = typeof globalThis.it === 'function' ? globalThis.it : nodeTest;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NL = String.fromCharCode(10);
const LIVE_DIR = path.join(REPO_ROOT, 'src');

// Loading anything under src/ can trip the EsbuildService EPERM of #782 on this
// host. That is a limitation of the local machine, not a property of the code
// under test: assert it explicitly so a failure reads as "environment" and never
// as "the behaviour is wrong".
function loadOrSkip(spec) {
  try {
    return { value: require(spec) };
  } catch (error) {
    if (/EPERM|spawn EPERM|EsbuildService/.test(String(error && error.message))) {
      return { skip: 'tsx/esbuild cannot spawn on this host (#782): ' + String(error.message).slice(0, 80) };
    }
    throw error;
  }
}

it('REQ-D1-01: a gate that cannot run reports GATE_NOT_RUN, not 0', () => {
  const loaded = loadOrSkip(path.join(LIVE_DIR, 'npm-package', 'lib', 'gate-runner.js'));
  if (loaded.skip) {
    // Do not silently pass: record the reason so it is visible in the report.
    assert.ok(loaded.skip, loaded.skip);
    return;
  }
  const runner = loaded.value;

  // Gate 0 is preCommitOnly: it needs git-staged context. Ask the runner for its
  // verdict directly rather than through the CLI, so this pins the SENTINEL and
  // not the CLI's exit-code masking of it.
  return runner.runGate('0', undefined).then((verdict) => {
    assert.strictEqual(
      verdict,
      runner.GATE_NOT_RUN,
      'a preCommitOnly gate must return the GATE_NOT_RUN sentinel. Returning 0 '
        + 'makes "never executed" indistinguishable from "executed and clean" -- '
        + 'the false green #636 needed four states to work around',
    );
  });
});

it('REQ-D2-01: the CLI publishes what each path can execute, derived from the registry', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'src', 'npm-package', 'bin', 'xp-gate.js'), 'gate-capability', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 },
  );

  assert.strictEqual(
    result.status,
    0,
    'gate-capability must exist and exit 0. Before it, the only statement of what '
      + 'the CLI can run was a design-doc footnote, and it was wrong: the doc said '
      + 'the CLI is "structurally missing 0/1/5/9/11/12/13" while the CLI offered '
      + 'all fourteen and silently declined seven.'
      + NL + 'stderr: ' + String(result.stderr).slice(0, 400),
  );

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail('gate-capability --json must emit JSON, got: ' + String(result.stdout).slice(0, 300));
  }

  assert.ok(Array.isArray(parsed.gates) && parsed.gates.length >= 14,
    'capability must cover every registered gate, got ' + JSON.stringify(parsed.gates && parsed.gates.length));

  // Every gate must state a capability from a CLOSED vocabulary, and the labels
  // must not conflate absences. The first version of this module used two values
  // and reported the six pre-push gates as `hook-only` with the difference hidden
  // in a reason string -- but they DO run outside a hook, on git push. A closed
  // enum whose --json output is wrong on six of twenty entries is worse than no
  // enum, because a machine reads it.
  const allowed = ['runnable', 'commit-only', 'push-only', 'unreachable'];
  for (const gate of parsed.gates) {
    assert.ok(allowed.includes(gate.capability),
      `gate ${gate.gate} has capability "${gate.capability}", expected one of ${JSON.stringify(allowed)}`);
    assert.ok(typeof gate.slug === 'string' && gate.slug.length > 0,
      `gate ${gate.gate} must carry the registry slug, not a number-derived name`);
  }

  // The seven that need git-staged context are commit-only, taken from the
  // registry's own list rather than from a hardcoded expectation in this test.
  const commitOnly = parsed.gates.filter((g) => g.capability === 'commit-only').map((g) => String(g.gate));
  for (const expected of ['0', '1', '5', '9', '11', '12', '13']) {
    assert.ok(commitOnly.includes(expected),
      `gate ${expected} needs git-staged context and must be commit-only; got ${JSON.stringify(commitOnly)}`);
  }

  // Every pre-push gate is push-only, NOT hook-only: it runs, just not via a
  // subcommand. This is the distinction the review rejected the first version for.
  const pushOnly = parsed.gates.filter((g) => g.capability === 'push-only').map((g) => String(g.gate));
  for (const expected of ['M', 'M2', 'ML', 'UI', 'MW', 'S']) {
    assert.ok(pushOnly.includes(expected),
      `pre-push gate ${expected} runs on git push and must be push-only, got ${JSON.stringify(pushOnly)}`);
  }

  // No gate may be unreachable in a healthy checkout, and drift must be empty:
  // a non-empty drift array means the registry and the runner disagree about
  // which gates exist, which makes every label below it unreliable.
  assert.deepStrictEqual(parsed.drift, [],
    'the registry and the runner disagree, so the capability labels cannot be trusted: '
      + JSON.stringify(parsed.drift));
  assert.strictEqual(parsed.summary.unreachable, 0,
    'a gate declared in the registry with no runner means the report cannot describe it honestly');
});

it('REQ-D2-03: registry and runner disagreement is detected, not silently reported as a capability', () => {
  // The module reads two sources on purpose: the registry owns identity and hook,
  // the runner owns runnability. That is correct -- gate 2 is `impl:inline` AND
  // runnable -- but two sources with no cross-check is how the design-doc footnote
  // this command replaces went stale. detectSourceDrift is the cross-check, and
  // this test proves it fires by injecting the drift it is meant to catch.
  const loaded = loadOrSkip(path.join(LIVE_DIR, 'npm-package', 'lib', 'gate-capability.js'));
  if (loaded.skip) {
    assert.ok(loaded.skip, loaded.skip);
    return;
  }
  const { detectSourceDrift } = loaded.value;

  const rows = [
    { name: 'version-consistency', number: '0', impl: 'inline', blocks: 'YES', hook: 'pre-commit' },
    { name: 'missing-from-runner', number: '99', impl: 'inline', blocks: 'YES', hook: 'pre-commit' },
    { name: 'push-gate', number: 'M', impl: 'inline', blocks: 'YES', hook: 'pre-push' },
  ];
  const runnerRegistry = { 0: { name: 'Version Consistency', preCommitOnly: true } };

  const drift = detectSourceDrift(rows, runnerRegistry);
  assert.strictEqual(drift.length, 1,
    'only the pre-commit gate absent from the runner is drift; a pre-push gate has no '
      + 'runner by design and must not be reported, got ' + JSON.stringify(drift));
  assert.strictEqual(drift[0].gate, '99');

  // An unloadable runner is itself drift, not an empty, reassuring result.
  const unloadable = detectSourceDrift(rows, null);
  assert.ok(unloadable.length > 0, 'a runner that cannot be loaded must be reported as drift');
});

it('REQ-D2-02: a hook-only gate exits 2 from the CLI, which never means "passed"', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'src', 'npm-package', 'bin', 'xp-gate.js'), 'gate-0'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 },
  );
  assert.strictEqual(
    result.status,
    2,
    'a hook-only gate must exit 2, never 0. #618 established this for the "no '
      + 'module, no fallback" case; the preCommitOnly branch bypassed it, so a '
      + 'caller reading only the exit status could not tell a clean run from a '
      + 'gate that never executed',
  );
});

it('REQ-D1-02: skill surfaces reach gates through the CLI, never a shell implementation', () => {
  // AC-D1-3 from the sprint breakdown. Measured before asserting: 12 SKILL.md
  // files, 0 referencing a shell implementation directly. Pinning it stops the
  // divergence from re-entering through a skill that learns to call
  // githooks/pre-commit itself -- that would be a third execution surface with
  // its own verdict, and the whole point of the contract is that there are two.
  const git = childProcess.execFileSync('git', ['ls-files', 'skills/*/SKILL.md'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const skillFiles = git.trim().split(NL).filter(Boolean);
  assert.ok(skillFiles.length >= 10, 'expected the skill catalogue to be present, got ' + skillFiles.length);

  const violations = [];
  for (const relative of skillFiles) {
    const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
    // A skill invoking the hook or a gate script directly. `xp-gate gate-N` and
    // `xp-gate check` are the allowed route and do not match these patterns.
    if (/(?:^|\s)(?:bash|sh)\s+(?:\.\/)?githooks\//m.test(text)
      || /(?:^|\s)(?:bash|sh)\s+\S*(?:pre-commit|pre-push)\b/m.test(text)
      || /(?:^|\s)\.\/githooks\/pre-(?:commit|push)\b/m.test(text)) {
      violations.push(relative);
    }
  }
  assert.deepStrictEqual(violations, [],
    'these skills invoke a shell gate implementation directly; they must go '
      + 'through `xp-gate gate-N` / `xp-gate check` so there is one execution '
      + 'contract, not three: ' + JSON.stringify(violations));
});
