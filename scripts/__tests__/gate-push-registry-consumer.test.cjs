#!/usr/bin/env node
/**
 * @test REQ-GATEID-003 — pre-push consumes the registry, and consumption is bookkeeping
 * @intent Before this change the registry knew nothing about any pre-push gate:
 *         MW, S, M, M2, ML and UI could not be looked up by name at all (#769),
 *         so half the gates this project runs had no identity anywhere. Adding
 *         the source also gives the registry its FIRST real consumer -- until
 *         then it was decorative, which is how it could publicly declare gate 6
 *         `inline` and stay wrong without a single test noticing.
 *
 *         The risk in adding a consumer is that the hook starts consulting the
 *         registry for EXECUTION policy. Then "registering a gate" silently
 *         becomes "turning a gate on", and behaviour changes with no test
 *         change. AC-GATEID-003-05 pins the safe version: the source is an
 *         insertion, and no pre-existing pre-push line may change.
 * @covers AC-GATEID-003-03, AC-GATEID-003-05
 */
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const assert = require('node:assert');
// Works under BOTH runners, which is what the hooks need: Gate 5 collects
// scripts/__tests__/*.cjs with vitest, while `node --test` is the local
// one-command repro. vitest injects describe/it as globals; node:test does not,
// so fall back to it only when the global is absent. A test file that runs under
// one runner and reports "No test suite found" under the other is not a passing
// test -- it is a skipped one wearing a green badge.
const { test: nodeTest } = require('node:test');
const it = typeof globalThis.it === 'function' ? globalThis.it : nodeTest;


const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PRE_PUSH = path.join(REPO_ROOT, 'githooks', 'pre-push');
const NL = String.fromCharCode(10);

it('AC-GATEID-003-03: pre-push sources the gate registry', () => {
  const source = fs.readFileSync(PRE_PUSH, 'utf8');
  const orders = source
    .split(NL)
    .map((line) => line.trim())
    .filter((line) => /^\.\s.*registry/i.test(line));
  assert.ok(
    orders.length >= 1,
    'pre-push must source gate-registry.sh, or every pre-push gate stays unnamed',
  );
  // Optional by contract: a consumer repo installed from an older package has no
  // registry, and the hook must still run there -- same as pre-commit:318-323.
  assert.match(
    source,
    /PRE_PUSH_REGISTRY_STATUS="missing"/,
    'a missing registry must be recorded as missing, never treated as fatal',
  );
});

it('AC-GATEID-003-04: the source is guarded, so an older consumer repo still runs', () => {
  // "Optional by contract" was asserted in a comment and nowhere else. An
  // unguarded `. "$REGISTRY"` in a repo installed before the registry existed
  // aborts the hook with "No such file or directory" on every push -- a
  // behaviour change no line-insertion diff can reveal. This pins the guard
  // rather than trusting the comment.
  const lines = fs.readFileSync(PRE_PUSH, 'utf8').split(NL);
  const sourceIdx = lines.findIndex((line) => /^\.\s.*registry/i.test(line.trim()));
  assert.notStrictEqual(sourceIdx, -1, 'pre-push should source the registry');

  // Walk back to the nearest `if`/`fi` enclosing control statement and require it
  // to test the registry path's existence.
  const before = lines.slice(Math.max(0, sourceIdx - 8), sourceIdx).join(NL);
  assert.match(
    before,
    /if\s+\[\s+-f\s+"\$_PRE_PUSH_REGISTRY"\s+\]/,
    'the registry source must sit inside `if [ -f "$_PRE_PUSH_REGISTRY" ]`, '
      + `otherwise a repo without the registry dies on every push. Context:\n${before}`,
  );

  // And the else branch must record absence rather than exiting.
  const after = lines.slice(sourceIdx, sourceIdx + 8).join(NL);
  assert.match(after, /PRE_PUSH_REGISTRY_STATUS="missing"/);
  assert.ok(
    !/exit\s+[1-9]/.test(after),
    'a missing registry must NOT abort the hook -- absence is not a push failure',
  );
});

it('AC-GATEID-003-05: sourcing the registry is insertion-only, never execution policy', () => {
  // The oracle: diff pre-push against the root commit, which predates the
  // registry source. Any removed line means a pre-existing statement changed,
  // i.e. gate order or skip semantics moved. Comparing gate-result multisets
  // would need a live remote; this pins the same property where it can actually
  // be checked, and fails loudly if someone later routes gate SELECTION through
  // the registry.
  //
  // Diffed against the root commit rather than HEAD so the test holds both
  // before this change is committed and after it lands.
  const rootCommit = childProcess
    .execSync('git rev-list --max-parents=0 HEAD', { cwd: REPO_ROOT, encoding: 'utf8' })
    .trim()
    .split(NL)[0];

  const removed = childProcess
    .execFileSync('git', ['diff', '-U0', rootCommit, '--', 'githooks/pre-push'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    .split(NL)
    .filter((line) => line.startsWith('-') && !line.startsWith('---'));

  assert.deepStrictEqual(
    removed,
    [],
    'the pre-push registry source must be an insertion; these pre-existing lines changed:'
      + NL
      + removed.join(NL),
  );
});
