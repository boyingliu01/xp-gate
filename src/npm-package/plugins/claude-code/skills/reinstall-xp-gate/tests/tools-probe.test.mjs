import test from 'node:test';
import assert from 'node:assert/strict';

import { toolReport, upgradeTool, classify } from '../scripts/lib/tools.mjs';

// The probing half of tools.mjs: everything that decides whether a gate tool is
// present, which version it is, and whether an upgrade is reachable.
//
// Why these are injected rather than run for real: every one of them shells out
// (npm, pip, where/which) or hits the network (PyPI, GitHub). A test that ran the
// real thing would assert against whatever happens to be installed on the machine
// running it -- green on a dev box with the full toolchain, red in CI -- and
// `pip install -U` can genuinely change the host.
//
// This half was 25% function coverage before these tests, despite carrying the
// decision that turns a row into 'outdated'. The risk is not academic: a wrong
// answer here either skips a needed gate-tool upgrade or warns on every run until
// the whole report is ignored.

/** A spawnSync-shaped result, matching the real one (stdout is a string). */
function ok(stdout = '') {
  return { status: 0, stdout, stderr: '', signal: null, pid: 1 };
}

function fail(status = 1) {
  return { status, stdout: '', stderr: 'boom', signal: null, pid: 1 };
}

/** A probe that resolves every tool to `path`, with `version` for all of them. */
function probeAll(path = (n) => `/usr/bin/${n}`, version = '1.0.0') {
  return (name) => ({ path: path(name), version });
}

/**
 * Report every pip row as present without asking pip.
 *
 * Several cases need the pip rows past `classify`'s 'missing' short-circuit to
 * reach the lookup under test; this is that setup, written once.
 */
function pipPresent(version = '1.0.0') {
  return (spec, row) => {
    row.present = true;
    row.version = version;
    row.path = '/usr/bin/pip-tool';
  };
}

/**
 * A fully isolated dependency set for toolReport.
 *
 * Every field is injected because omitting one makes toolReport fall back to the
 * real probe, which shells out (`which python`, `npm view`) or hits the network.
 * An earlier version of these tests omitted `pipProbe` and paid a live lookup per
 * case -- slow enough to look like a hang and non-deterministic enough to pass on
 * a dev box and fail in CI.
 */
function isolated(overrides = {}) {
  return {
    toolVersion: () => ({ path: '', version: '' }),
    pipProbe: () => { },
    pythonBin: () => '',
    lookup: async () => '',
    ...overrides,
  };
}

// ── probing ─────────────────────────────────────────────────────────────────

test('toolReport probes every declared tool exactly once', async () => {
  const seen = [];
  const rows = await toolReport(isolated({
    toolVersion: (name) => {
      seen.push(name);
      return { path: `/usr/bin/${name}`, version: '1.0.0' };
    },
  }));
  assert.equal(rows.length > 0, true);
  // A tool probed twice doubles the spawn cost of every reinstall run; one probed
  // zero times silently keeps its row defaults.
  assert.equal(new Set(seen).size, seen.length);
});

test('a present tool is marked present and keeps the path the probe found', async () => {
  const rows = await toolReport(isolated({
    toolVersion: probeAll((n) => `/opt/bin/${n}`, '2.1.0'),
    lookup: async () => '2.1.0',
  }));
  const npmRow = rows.find((r) => r.kind === 'npm');
  assert.equal(npmRow.present, true);
  assert.equal(npmRow.path, `/opt/bin/${npmRow.name}`);
  assert.equal(npmRow.status, 'ok');
});

test('an absent tool is reported missing, not simply dropped from the list', async () => {
  // A row dropped instead of marked 'missing' makes the report look complete
  // while a gate tool is absent -- exactly the silent-pass shape.
  const rows = await toolReport(isolated({ lookup: async () => '9.9.9' }));
  const missing = rows.filter((r) => !r.present);
  assert.ok(missing.length > 0);
  for (const row of missing) assert.equal(row.status, 'missing');
});

test('the latest-version lookup reaches every tool kind', async () => {
  const asked = {};
  await toolReport(isolated({
    toolVersion: probeAll(),
    pipProbe: pipPresent(),
    lookup: async (row) => {
      (asked[row.kind] ||= []).push(row.name);
      return '';
    },
  }));
  for (const kind of ['npm', 'pip', 'binary']) {
    assert.ok(asked[kind]?.length > 0, `no ${kind} lookups`);
  }
  // `node` (npx) is present and so does reach classify's lookup, but
  // `latestFor` answers '' for it by design -- there is no peer version to
  // compare. The row is 'ok' regardless, which the next test pins.
  assert.deepEqual(asked.node, ['npx']);
  const names = Object.values(asked).flat();
  assert.equal(new Set(names).size, names.length, 'a row was looked up twice');
});

test('binary tools keep their raw version string instead of a parsed one', async () => {
  // gitleaks prints "gitleaks version 8.18.2". A binary's version is displayed
  // as-is, so the parse must not rewrite it before it is shown.
  const rows = await toolReport(isolated({ toolVersion: probeAll(undefined, 'gitleaks version 8.18.2') }));
  const binaryRow = rows.find((r) => r.kind === 'binary');
  assert.equal(binaryRow.version, 'gitleaks version 8.18.2');
});

test('npm rows store a parsed version so the comparison stays numeric', async () => {
  const rows = await toolReport(isolated({ toolVersion: probeAll(undefined, 'npm 9.8.1') }));
  const npmRow = rows.find((r) => r.kind === 'npm');
  assert.equal(npmRow.version, '9.8.1');
});

test('a pip tool falls back to the PATH hit when pip metadata is unavailable', async () => {
  // pip show answers nothing but the tool is on PATH: the row must still read as
  // present, otherwise a working tool is reported as missing.
  const rows = await toolReport(isolated({
    toolVersion: () => ({ path: '/usr/bin/lizard', version: '1.17.10' }),
    pipProbe: (spec, row, deps) => {
      assert.equal(deps.pythonBin(), '', 'no interpreter was injected');
      row.present = true;
      row.version = '1.17.10';
      row.path = '/usr/bin/lizard';
    },
  }));
  const pipRow = rows.find((r) => r.kind === 'pip');
  assert.equal(pipRow.present, true);
  assert.equal(pipRow.version, '1.17.10');
});

test('a pip tool with neither metadata nor a PATH hit stays missing', async () => {
  const rows = await toolReport(isolated());
  for (const row of rows.filter((r) => r.kind === 'pip')) {
    assert.equal(row.present, false);
    assert.equal(row.status, 'missing');
  }
});

test('toolReport passes one lookup through to every probed row', async () => {
  const calls = [];
  await toolReport(isolated({
    toolVersion: probeAll(),
    lookup: async (row) => {
      calls.push(row);
      return '';
    },
  }));
  assert.ok(calls.length > 0);
  for (const row of calls) assert.equal(typeof row.name, 'string');
});

test('the default lookup is never reached when every tool is absent', async () => {
  // Guards the fix documented on toolReport: `rows.map(classify)` would pass the
  // array index as `lookup` and throw "lookup is not a function". classify
  // short-circuits on absent rows, so the run must not throw -- and with no
  // injected lookup it must not reach the network either.
  const rows = await toolReport(isolated());
  assert.ok(rows.every((r) => r.status === 'missing'));
  assert.ok(rows.every((r) => r.latest === ''));
});

// ── interaction with classify ────────────────────────────────────────────────

test('toolReport marks a tool whose latest lookup failed as unverified, not ok', async () => {
  // An empty lookup result means nothing was compared. Reporting 'ok' there is
  // the silent pass this project exists to avoid.
  const rows = await toolReport(isolated({
    toolVersion: probeAll(),
    // pip rows must be present too, otherwise they short-circuit to 'missing'
    // and never reach the lookup this test is about.
    pipProbe: pipPresent(),
    lookup: async () => '',
  }));
  const present = rows.filter((r) => r.present && r.kind !== 'node');
  assert.ok(present.length > 0, 'no present non-node rows to classify');
  for (const row of present) {
    assert.equal(row.status, 'unverified', `${row.name} claimed ok without comparing`);
  }
});

test('toolReport keeps npx ok when the lookup fails, since it has no peer version', async () => {
  const rows = await toolReport(isolated({
    toolVersion: probeAll(undefined, '24.0.0'),
    pipProbe: pipPresent(),
  }));
  const nodeRow = rows.find((r) => r.kind === 'node');
  assert.equal(nodeRow.status, 'ok');
});

test('toolReport flags a tool that is behind as outdated', async () => {
  const rows = await toolReport(isolated({
    toolVersion: probeAll(),
    pipProbe: pipPresent(),
    lookup: async () => '2.5.0',
  }));
  const outdated = rows.filter((r) => r.status === 'outdated');
  assert.ok(outdated.length > 0);
  assert.equal(outdated[0].latest, '2.5.0');
});

test('classify still honours an explicitly injected lookup (regression guard)', async () => {
  const row = await classify({ present: true, kind: 'npm', version: '1.0.0', latest: '' }, async () => '3.0.0');
  assert.equal(row.status, 'outdated');
  assert.equal(row.latest, '3.0.0');
});

// ── upgradeTool ──────────────────────────────────────────────────────────────
// These invoke real global installs in production. Each case asserts the exact
// command AND that nothing ran for the kinds that must not.

test('npm upgrade runs a global install of the pinned package', () => {
  const calls = [];
  const code = upgradeTool(
    { name: 'jscpd', kind: 'npm', pkg: 'jscpd' },
    { runNpm: (args, opts) => { calls.push({ args, opts }); return ok(); } },
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['install', '-g', 'jscpd@latest']);
});

test('npm upgrade propagates a non-zero status instead of claiming success', () => {
  const code = upgradeTool({ name: 'jscpd', kind: 'npm', pkg: 'jscpd' }, { runNpm: () => fail(7) });
  assert.equal(code, 7);
});

test('npm upgrade reports failure when spawn produced no status at all', () => {
  // A signal-killed or ENOENT spawn has no status; treating that as 0 would
  // report a successful upgrade for a command that never ran.
  const code = upgradeTool({ name: 'jscpd', kind: 'npm', pkg: 'jscpd' }, { runNpm: () => ({ status: undefined }) });
  assert.equal(code, 1);
});

test('pip upgrade runs pip install -U through the discovered interpreter', () => {
  const calls = [];
  const code = upgradeTool(
    { name: 'lizard', kind: 'pip', pkg: 'lizard' },
    {
      pythonBin: () => '/usr/bin/python3',
      run: (cmd, args) => { calls.push({ cmd, args }); return ok(); },
    },
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/usr/bin/python3');
  assert.deepEqual(calls[0].args, ['-m', 'pip', 'install', '-U', 'lizard']);
});

test('pip upgrade fails without touching the system when no interpreter exists', () => {
  let spawned = false;
  const code = upgradeTool(
    { name: 'lizard', kind: 'pip', pkg: 'lizard' },
    { pythonBin: () => '', run: () => { spawned = true; return ok(); } },
  );
  assert.equal(code, 1);
  assert.equal(spawned, false);
});

test('pip upgrade propagates a failing install status', () => {
  const code = upgradeTool(
    { name: 'lizard', kind: 'pip', pkg: 'lizard' },
    { pythonBin: () => '/usr/bin/python3', run: () => fail(2) },
  );
  assert.equal(code, 2);
});

test('binary upgrade only advises and never downloads over the user PATH', () => {
  const logs = [];
  let spawned = false;
  const code = upgradeTool(
    { name: 'gitleaks', kind: 'binary', repo: 'gitleaks/gitleaks', latest: '8.18.2' },
    {
      log: (m) => logs.push(m),
      run: () => { spawned = true; return ok(); },
      runNpm: () => { spawned = true; return ok(); },
    },
  );
  assert.equal(code, 0);
  assert.equal(spawned, false, 'binary upgrade must not install anything');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /gitleaks/);
  assert.match(logs[0], /gitleaks\/gitleaks/);
  assert.match(logs[0], /8\.18\.2/);
});

test('binary upgrade names the repo and latest version for the operator', () => {
  const logs = [];
  upgradeTool({ name: 'jq', kind: 'binary', repo: 'jqlang/jq', latest: '1.7.1' }, { log: (m) => logs.push(m) });
  assert.match(logs[0], /jqlang\/jq/);
  assert.match(logs[0], /1\.7\.1/);
});

test('binary upgrade degrades gracefully when repo and version are unknown', () => {
  const logs = [];
  const code = upgradeTool({ name: 'mystery', kind: 'binary' }, { log: (m) => logs.push(m) });
  assert.equal(code, 0);
  assert.match(logs[0], /官方 release/);
  assert.match(logs[0], /最新版/);
});

test('an unknown kind is a no-op success rather than a crash', () => {
  // A spec that declares a new kind before its upgrader exists must not take the
  // whole reinstall run down.
  for (const kind of ['node', 'something-new', '']) {
    assert.doesNotThrow(() => upgradeTool({ name: 'x', kind }, {}));
    assert.equal(upgradeTool({ name: 'x', kind }, {}), 0);
  }
});

test('upgradeTool never spawns for a kind it has no command for', () => {
  let spawned = false;
  const deps = {
    runNpm: () => { spawned = true; return ok(); },
    run: () => { spawned = true; return ok(); },
    pythonBin: () => '/usr/bin/python3',
    log: () => { },
  };
  upgradeTool({ name: 'npx', kind: 'node' }, deps);
  assert.equal(spawned, false);
});

test('upgradeTool defaults to the real commands when no deps are injected', () => {
  // Only the `node` kind is safe to call here: it has no upgrader, so this
  // asserts the default lookup path without installing anything.
  assert.equal(upgradeTool({ name: 'npx', kind: 'node' }), 0);
});
