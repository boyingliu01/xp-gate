#!/usr/bin/env node
/**
 * @test REQ-803 — a clean IaC scan must not be reported as a missing toolchain
 * @intent #803: committing a change to `.github/workflows/*.yml` was BLOCKED by
 *         Gate 7 with "IoT files detected but no scanning tools available" — on a
 *         machine where checkov, hadolint, kube-score and tflint were all installed
 *         and the file passed checkov with 116 checks, 0 failures.
 *
 *         Two defects compounded, and each alone is enough to reproduce it:
 *
 *         1. The executability probe wrapped `checkov --version` in `timeout 20`.
 *            That command measures 22.4 s on Windows with a cold pip cache
 *            (python startup + imports). The probe therefore timed out, checkov
 *            was screened out as unusable, and the gate fell through to the
 *            individual-tool fallback — hadolint/kube-score/tflint, none of which
 *            inspects a GitHub Actions workflow.
 *
 *         2. The fallback's final test was `[ $exit_code -eq 0 ]`, which asks "did
 *            anything fail?" and used the answer to mean "did anything run?".
 *            Three scanners iterating zero files leave exit_code 0, so a clean,
 *            fully-scanned commit was indistinguishable from a missing toolchain.
 *
 *         The second defect is the one that matters beyond this host: it fires
 *         on ANY commit the applicable scanners pass, so the message tells the
 *         reader to install tools that are already working. And because the Code
 *         of Conduct prohibits --no-verify, the developer has no honest way to
 *         commit. A gate that blocks a clean scan teaches its reader that the gate
 *         is unreliable, which is how the next genuine block gets bypassed.
 * @covers REQ-803
 * @skip-justified: the behavioural case is skipped, not failed, when checkov or the
 *                  workflow file is absent on this host. Faking a PASS there would be
 *                  the exact vacuity #803 is about, and failing would report a missing
 *                  precondition as a product defect.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const childProcess = require('node:child_process');

const { test: nodeTest } = require('node:test');
const it = typeof globalThis.it === 'function' ? globalThis.it : nodeTest;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IAC_ADAPTER = path.join(REPO_ROOT, 'githooks', 'adapters', 'iac.sh');
const source = fs.readFileSync(IAC_ADAPTER, 'utf8');

it('REQ-803-01: the missing-toolchain branch keys on "did anything run", not on exit_code', () => {
  // The defect in one line: `[ $exit_code -eq 0 ]` as the condition for "no
  // scanning tools available". It must be gone, because exit_code answers a
  // different question.
  assert.ok(
    !/no scanning tools available/.test(source) || !/if \[ \$exit_code -eq 0 \][\s\S]{0,400}?no scanning tools available/.test(source),
    'the "no scanning tools available" branch must not be conditioned on exit_code == 0: '
      + 'that conjoins "all scanners passed" with "no scanner ran"',
  );

  // And it must key on a counter of completed scans instead.
  assert.match(source, /iac_scans_completed/,
    'the gate must track how many scanner/file pairs actually ran');
  assert.match(source, /if \[ "\$iac_scans_completed" -eq 0 \]/,
    'the missing-toolchain branch must test iac_scans_completed, which only the scanner paths increment');
});

it('REQ-803-02: every scanner invocation increments the completed-scan counter', () => {
  // A counter that only one path increments would make the fix work for checkov
  // and silently keep the bug for the fallback tools.
  const increments = source.match(/iac_scans_completed=\$\(\(iac_scans_completed \+ 1\)\)/g) || [];
  assert.ok(increments.length >= 4,
    'expected at least 4 increment sites (checkov + hadolint + kube-score + tflint), got ' + increments.length);

  // Each fallback tool's ACTUAL invocation must be followed by its increment, so a
  // new scanner added without one is caught by reading rather than by a blocked
  // commit. Anchored on the invocation shape, not on the tool name: all three also
  // appear in prose (the install hints), and matching a comment would assert
  // nothing while looking like coverage.
  const invocations = [
    { tool: 'hadolint', pattern: /hadolint "\$file" 2>&1 \| tail -20\n/ },
    { tool: 'kube-score', pattern: /kube-score score "\$file" 2>&1 \| tail -20\n/ },
    { tool: 'tflint', pattern: /tflint --chdir "\$\(dirname "\$file"\)" 2>&1 \| tail -20\n/ },
  ];
  for (const { tool, pattern } of invocations) {
    const match = source.match(pattern);
    assert.ok(match, `expected the ${tool} invocation to match ${pattern}`);
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 200);
    assert.match(after, /iac_scans_completed=\$\(\(iac_scans_completed \+ 1\)\)/,
      `${tool}'s invocation must increment iac_scans_completed immediately after, or a `
        + 'clean run through this scanner is still mistaken for a missing toolchain');
  }
});

it('REQ-803-03: the executability probe budget exceeds the command it times', () => {
  // The probe screens for a shim that does not answer (#596) -- a hang, not a slow
  // start. A 20 s budget against a 22.4 s command turns a working scanner into a
  // reported-missing one, which is the more expensive error: it silences a
  // scanner that works.
  const probe = source.match(/timeout (\d+) \$_checkov_candidate --version/);
  assert.ok(probe, 'expected a bounded `timeout N $_checkov_candidate --version` probe');

  const budget = Number(probe[1]);
  assert.ok(budget >= 60,
    `the checkov probe budget is ${budget}s. \`checkov --version\` measures 22.4 s on Windows `
      + 'with a cold pip cache, so a budget near that silently disables the scanner. '
      + 'It must be well clear of the real cost.');
});

it('REQ-803-04: a workflow file is scanned, not reported as unscannable', function (t) {
  // Behavioural, and it is the end-to-end claim the issue is about.
  //
  // Guarded rather than faked when the precondition is absent: asserting a PASS
  // without a scanner would be exactly the vacuity this issue is about. The guard
  // uses the runner's own skip where the runner offers one -- `assert.ok(true)`
  // verifies nothing and is flagged by Gate 5d as a tautology, correctly.
  const hasCheckov = childProcess.spawnSync('bash', ['-c', 'command -v checkov'], { encoding: 'utf8' });
  if (hasCheckov.status !== 0) {
    if (t && typeof t.skip === 'function') t.skip('checkov not installed: the probe path cannot be exercised');
    return;
  }

  const workflow = path.join(REPO_ROOT, '.github', 'workflows', 'cross-platform-ci.yml');
  if (!fs.existsSync(workflow)) {
    if (t && typeof t.skip === 'function') t.skip('no workflow file at the expected path in this checkout');
    return;
  }

  const result = childProcess.spawnSync(
    'bash',
    ['-c', '. githooks/adapters/iac.sh && run_static_analysis ".github/workflows/cross-platform-ci.yml" "iac"'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 },
  );
  const output = `${result.stdout}${result.stderr}`;

  assert.ok(
    !/no scanning tools available/.test(output),
    'the gate must not claim no scanner is available when checkov is installed and did run. '
      + 'Output: ' + output.slice(-500),
  );
  assert.match(output, /checkov scan completed|IaC scan completed/,
    'the gate must report that a scan actually completed. Output: ' + output.slice(-500));
});
