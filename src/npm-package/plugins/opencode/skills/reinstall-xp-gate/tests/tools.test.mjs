import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';

import {
  semverOf, cmpVersion, TOOLS, classify, statusOf, PACKAGE_INSTALL_TIMEOUT_MS,
} from '../scripts/lib/tools.mjs';

// semverOf + cmpVersion decide "is this tool outdated". A wrong answer either
// silently skips an upgrade (gate tool stays old) or claims a bogus upgrade is
// available on every run and trains the operator to ignore the report.

test('semverOf extracts a version from the shapes real tools print', () => {
  assert.equal(semverOf('1.2.3'), '1.2.3');
  assert.equal(semverOf('v2.0.0'), '2.0.0');
  assert.equal(semverOf('jscpd 3.5.10'), '3.5.10');
  assert.equal(semverOf('lizard (1.17.10)'), '1.17.10');
  assert.equal(semverOf('gitleaks version 8.18.2'), '8.18.2');
  // Fourth component is kept: several gate tools ship 4-part versions.
  assert.equal(semverOf('1.2.3.4'), '1.2.3.4');
});

test('semverOf returns empty string when no version is present', () => {
  assert.equal(semverOf(''), '');
  assert.equal(semverOf(null), '');
  assert.equal(semverOf('not found'), '');
});

test('cmpVersion compares numerically, not lexically', () => {
  // "10" must beat "9". A string compare would rank 9 higher and the upgrade
  // would never fire for double-digit minors.
  assert.equal(cmpVersion('1.10.0', '1.9.0'), 1);
  assert.equal(cmpVersion('1.9.0', '1.10.0'), -1);
  assert.equal(cmpVersion('10.0.0', '9.9.9'), 1);
});

test('cmpVersion treats missing components as zero', () => {
  assert.equal(cmpVersion('1.2', '1.2.0'), 0);
  assert.equal(cmpVersion('1.2.0', '1.2'), 0);
  assert.equal(cmpVersion('1.2.1', '1.2'), 1);
});

test('cmpVersion ranks a bare major as OLDER, not equal', () => {
  // semverOf requires at least two components, by design: it must not mistake a
  // stray integer in tool output for a version. So "1" parses to '' and compares
  // as [0], ranking below 1.0.0. Pinning this because it looks like a bug but is
  // the intended trade-off -- a looser regex would pick up build numbers and
  // produce false "outdated" reports.
  assert.equal(semverOf('1'), '');
  assert.equal(cmpVersion('1', '1.0.0'), -1);
});

test('cmpVersion returns 0 only for equal versions', () => {
  assert.equal(cmpVersion('3.5.10', '3.5.10'), 0);
  assert.equal(cmpVersion('v3.5.10', '3.5.10'), 0);
});

test('cmpVersion handles unparseable input without throwing', () => {
  assert.doesNotThrow(() => cmpVersion('garbage', '1.0.0'));
  assert.equal(cmpVersion('garbage', '1.0.0'), -1);
});

test('TOOLS declares every tool the verify step expects, with a usable spec', () => {
  const names = TOOLS.map((t) => t.name);
  for (const required of ['jscpd', 'lizard', 'checkov', 'hadolint', 'gitleaks', 'semgrep', 'npx', 'jq']) {
    assert.ok(names.includes(required), `missing tool spec: ${required}`);
  }
  // Every entry needs a dispatcher, otherwise upgradeTool returns 0 and the
  // report claims success while the tool is never upgraded. The table says what
  // each kind owes; a new kind that nobody wires up fails the first assertion.
  const REQUIRED_FIELD = { npm: 'pkg', pip: 'pkg', binary: 'repo' };
  const KINDS = ['npm', 'pip', 'binary', 'node'];
  for (const tool of TOOLS) {
    assert.ok(KINDS.includes(tool.kind), `bad kind for ${tool.name}`);
    const field = REQUIRED_FIELD[tool.kind];
    if (field) assert.ok(tool[field], `${tool.name} (${tool.kind}) needs ${field}`);
  }
});

test('classify reports a missing tool as missing, never as ok', () => {
  return classify({ present: false, kind: 'npm', version: '', latest: '' }).then((row) => {
    assert.equal(row.status, 'missing');
  });
});

test('classify marks a tool outdated only when it is genuinely behind', async () => {
  const behind = await classify({ present: true, kind: 'npm', version: '1.0.0', latest: '' }, async () => '2.0.0');
  assert.equal(behind.status, 'outdated');
  assert.equal(behind.latest, '2.0.0');

  const current = await classify({ present: true, kind: 'npm', version: '2.0.0', latest: '' }, async () => '2.0.0');
  assert.equal(current.status, 'ok');
});

test('classify separates "could not look up" from "up to date"', async () => {
  // The distinction that matters: an empty `latest` means nothing was compared.
  // Reporting that as 'ok' claims a tool is current on the strength of a failed
  // network call, which is the silent-pass shape this project exists to avoid.
  const unknown = await classify({ present: true, kind: 'npm', version: '1.0.0', latest: '' }, async () => '');
  assert.equal(unknown.status, 'unverified');
});

test('classify treats node/npx as ok when present, since it has no peer version', async () => {
  const row = await classify({ present: true, kind: 'node', version: '24.0.0', latest: '' }, async () => '');
  assert.equal(row.status, 'ok');
});

test('statusOf blocks an upgrade claim on an unparseable version', () => {
  // cmpVersion ranks '' below anything numeric, so a tool whose version could
  // not be read counts as behind -- never as current.
  assert.equal(statusOf({ kind: 'npm', version: '', latest: '2.0.0' }), 'outdated');
  assert.equal(statusOf({ kind: 'npm', version: '2.0.0', latest: '' }), 'unverified');
});

// ---------------------------------------------------------------------------
// Install budget (magic-number refactor).
//
// Two sites installed a global package -- `npm install -g` and `pip install -U`
// -- and both carried a bare 600000. Same intent, copied twice: change one and
// the other silently keeps the old budget.
// ---------------------------------------------------------------------------

test('PACKAGE_INSTALL_TIMEOUT_MS covers both npm and pip global installs', () => {
  assert.equal(PACKAGE_INSTALL_TIMEOUT_MS, 600000);
});

test('both global-install call sites use PACKAGE_INSTALL_TIMEOUT_MS', () => {
  const src = fs.readFileSync(new URL('../scripts/lib/tools.mjs', import.meta.url), 'utf8');
  assert.deepEqual(src.match(/timeout: 600000\b/g) || [], [], 'install sites must use the constant');
});
