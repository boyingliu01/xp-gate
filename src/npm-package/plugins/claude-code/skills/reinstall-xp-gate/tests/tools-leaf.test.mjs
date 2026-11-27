import test from 'node:test';
import assert from 'node:assert/strict';

import {
  npmLatest,
  pythonBin,
  pipShowVersion,
  pipLatest,
  fetchJsonVersion,
  pypiLatest,
  githubLatest,
  pipProbe,
  detect,
  latestFor,
} from '../scripts/lib/tools.mjs';

// The leaf probes behind toolReport: each one talks to a package manager or an
// HTTP endpoint. They are covered here directly because their only failure mode
// is a silent '' -- an unavailable lookup that would otherwise be indistinguishable
// from "this tool is current".

function ok(stdout = '') {
  return { status: 0, stdout, stderr: '', signal: null, pid: 1 };
}

function fail(status = 1, stdout = '') {
  return { status, stdout, stderr: 'boom', signal: null, pid: 1 };
}

/** A fetch stand-in returning `body` as JSON, or a non-ok response. */
function fakeFetch(body, { okStatus = true } = {}) {
  return async () => ({
    ok: okStatus,
    json: async () => body,
  });
}

// ── npmLatest ────────────────────────────────────────────────────────────────

test('npmLatest trims the version npm prints', () => {
  // The real `runNpm` output ends with a newline (measured on this machine:
  // "5.4.3\n"). Without the trim every version comparison carries it.
  assert.equal(npmLatest('jscpd', () => ok('5.4.3\n')), '5.4.3');
});

test('npmLatest returns empty when npm exits non-zero', () => {
  assert.equal(npmLatest('gone', () => fail(1, '5.4.3\n')), '');
});

test('npmLatest asks npm for the bare version, not the full packument', () => {
  const calls = [];
  npmLatest('jscpd', (args) => { calls.push(args); return ok('5.4.3'); });
  assert.deepEqual(calls[0], ['view', 'jscpd', 'version']);
});

// ── pythonBin ────────────────────────────────────────────────────────────────

test('pythonBin returns the first interpreter that resolves', () => {
  const tried = [];
  const found = pythonBin((name) => {
    tried.push(name);
    return name === 'python3' ? '/usr/bin/python3' : '';
  });
  assert.equal(found, '/usr/bin/python3');
  // 'py' is the Windows launcher: it must not be tried once one resolved.
  assert.deepEqual(tried, ['python', 'python3']);
});

test('pythonBin tries the Windows launcher last', () => {
  const tried = [];
  const found = pythonBin((name) => { tried.push(name); return ''; });
  assert.equal(found, '');
  assert.deepEqual(tried, ['python', 'python3', 'py']);
});

// ── pipShowVersion ───────────────────────────────────────────────────────────

test('pipShowVersion reads the Version: line from pip show', () => {
  const v = pipShowVersion('lizard', () => '/usr/bin/python3', () => ok('Name: lizard\nVersion: 1.17.10\nSummary: x\n'));
  assert.equal(v, '1.17.10');
});

test('pipShowVersion returns empty when no interpreter is available', () => {
  let spawned = false;
  const v = pipShowVersion('lizard', () => '', () => { spawned = true; return ok(''); });
  assert.equal(v, '');
  assert.equal(spawned, false);
});

test('pipShowVersion returns empty when pip exits non-zero', () => {
  assert.equal(pipShowVersion('gone', () => '/usr/bin/python3', () => fail(1, 'Version: 9.9.9\n')), '');
});

test('pipShowVersion returns empty when the output has no Version line', () => {
  assert.equal(pipShowVersion('x', () => '/usr/bin/python3', () => ok('WARNING: Package(s) not found\n')), '');
});

// ── pipLatest ────────────────────────────────────────────────────────────────

test('pipLatest prefers the short `pip index versions` response', async () => {
  let fellBack = false;
  const v = await pipLatest('lizard', {
    pythonBin: () => '/usr/bin/python3',
    run: () => ok('lizard (1.17.10)\nAvailable versions: 1.17.10, 1.17.9\n'),
    pypiLatest: async () => { fellBack = true; return '9.9.9'; },
  });
  assert.equal(v, '1.17.10');
  assert.equal(fellBack, false, 'must not hit PyPI when pip answered');
});

test('pipLatest falls back to PyPI when pip index fails', async () => {
  // checkov's PyPI JSON is tens of MB and does not finish in 8 s, so `pip index`
  // is tried first; the fallback must still fire when it is unavailable.
  const v = await pipLatest('checkov', {
    pythonBin: () => '/usr/bin/python3',
    run: () => fail(1),
    pypiLatest: async () => '3.2.1',
  });
  assert.equal(v, '3.2.1');
});

test('pipLatest falls back to PyPI when no interpreter resolves', async () => {
  const v = await pipLatest('checkov', {
    pythonBin: () => '',
    pypiLatest: async () => '3.2.1',
  });
  assert.equal(v, '3.2.1');
});

test('pipLatest falls back when pip output has no version in parentheses', async () => {
  const v = await pipLatest('lizard', {
    pythonBin: () => '/usr/bin/python3',
    run: () => ok('ERROR: No matching distribution\n'),
    pypiLatest: async () => '2.0.0',
  });
  assert.equal(v, '2.0.0');
});

// ── fetchJsonVersion ─────────────────────────────────────────────────────────

test('fetchJsonVersion returns the parsed body on success', async () => {
  const body = { info: { version: '1.2.3' } };
  assert.deepEqual(await fetchJsonVersion('https://example.test/x', 1000, fakeFetch(body)), body);
});

test('fetchJsonVersion returns null on a non-ok response', async () => {
  assert.equal(await fetchJsonVersion('https://example.test/x', 1000, fakeFetch({}, { okStatus: false })), null);
});

test('fetchJsonVersion returns null instead of throwing on a network error', async () => {
  // An offline machine or a DNS failure must degrade to "unverified", never
  // crash the whole reinstall run.
  const throwing = async () => { throw new Error('ENOTFOUND'); };
  assert.equal(await fetchJsonVersion('https://example.test/x', 1000, throwing), null);
});

test('fetchJsonVersion returns null when the body is not JSON', async () => {
  const badJson = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } });
  assert.equal(await fetchJsonVersion('https://example.test/x', 1000, badJson), null);
});

// ── pypiLatest / githubLatest ────────────────────────────────────────────────

test('pypiLatest reads info.version', async () => {
  assert.equal(await pypiLatest('lizard', fakeFetch({ info: { version: '1.17.10' } })), '1.17.10');
});

test('pypiLatest tolerates a payload without info', async () => {
  assert.equal(await pypiLatest('lizard', fakeFetch({})), '');
});

test('pypiLatest returns empty when the request fails', async () => {
  assert.equal(await pypiLatest('lizard', fakeFetch({}, { okStatus: false })), '');
});

test('githubLatest reads tag_name without the leading v', async () => {
  // GitHub tags are "v8.18.2"; the comparison needs the bare number or every
  // binary tool reads as outdated on every run.
  assert.equal(await githubLatest('gitleaks/gitleaks', fakeFetch({ tag_name: 'v8.18.2' })), '8.18.2');
});

test('githubLatest tolerates a payload without tag_name', async () => {
  assert.equal(await githubLatest('a/b', fakeFetch({})), '');
});

test('githubLatest returns empty when the request fails', async () => {
  assert.equal(await githubLatest('a/b', fakeFetch({}, { okStatus: false })), '');
});

// ── pipProbe ─────────────────────────────────────────────────────────────────

/** A fresh, unprobed pip row. Each test owns its own so order cannot leak. */
function pipRow(name = 'lizard') {
  return { name, kind: 'pip', pkg: name, path: '', present: false, version: '', latest: '' };
}

/**
 * Run pipProbe with pip metadata answering `shown` and the PATH probe at `path`.
 * The metadata branch decides version/path precedence, so every case here
 * controls the two sources independently.
 */
function probeWithPip(row, { shown = '1.17.10', path = '/usr/bin/lizard', version = '1.17.10' } = {}) {
  pipProbe({ name: row.name, pkg: row.pkg }, row, {
    pythonBin: () => '/usr/bin/python3',
    pipShowVersion: () => shown,
    toolVersion: () => ({ path, version }),
  });
  return row;
}

test('pipProbe records pip metadata when pip show answers', () => {
  const row = probeWithPip(pipRow());
  assert.equal(row.present, true);
  assert.equal(row.version, '1.17.10');
  assert.equal(row.path, '/usr/bin/lizard');
});

test('pipProbe synthesises a path when pip knows the package but PATH does not', () => {
  // Installed in a venv that is not on PATH: still present, and the path has to
  // say how to reach it rather than being empty.
  const row = pipRow();
  pipProbe({ name: 'lizard', pkg: 'lizard' }, row, {
    pythonBin: () => '/usr/bin/python3',
    pipShowVersion: () => '1.17.10',
    toolVersion: () => ({ path: '', version: '' }),
  });
  assert.equal(row.present, true);
  assert.equal(row.path, 'python -m pip show lizard');
});

test('pipProbe falls back to the PATH probe when pip metadata is empty', () => {
  const row = pipRow();
  pipProbe({ name: 'lizard', pkg: 'lizard' }, row, {
    pythonBin: () => '/usr/bin/python3',
    pipShowVersion: () => '',
    toolVersion: () => ({ path: '/usr/local/bin/lizard', version: '1.17.10' }),
  });
  assert.equal(row.present, true);
  assert.equal(row.version, '1.17.10');
  assert.equal(row.path, '/usr/local/bin/lizard');
});

test('pipProbe leaves the row absent when neither source answers', () => {
  const row = pipRow();
  pipProbe({ name: 'lizard', pkg: 'lizard' }, row, {
    pythonBin: () => '',
    pipShowVersion: () => '',
    toolVersion: () => ({ path: '', version: '' }),
  });
  assert.equal(row.present, false);
  assert.equal(row.path, '');
});

// ── detect ───────────────────────────────────────────────────────────────────

test('detect defaults a non-pip row to absent when the probe finds nothing', () => {
  const row = detect({ name: 'jscpd', kind: 'npm', pkg: 'jscpd' }, { toolVersion: () => ({ path: '', version: '' }) });
  assert.equal(row.present, false);
  assert.equal(row.status, 'ok', 'status is left for classify to decide');
});

test('detect marks a non-pip row present from the PATH probe', () => {
  const row = detect({ name: 'jscpd', kind: 'npm', pkg: 'jscpd' }, {
    toolVersion: () => ({ path: '/usr/bin/jscpd', version: 'jscpd 5.4.3' }),
  });
  assert.equal(row.present, true);
  assert.equal(row.path, '/usr/bin/jscpd');
  assert.equal(row.version, '5.4.3');
});

test('detect routes pip specs through pipProbe', () => {
  const row = detect({ name: 'lizard', kind: 'pip', pkg: 'lizard' }, {
    pipProbe: (spec, r) => { r.present = true; r.version = '9.9.9'; r.path = '/x'; },
  });
  assert.equal(row.present, true);
  assert.equal(row.version, '9.9.9');
});

// ── latestFor ────────────────────────────────────────────────────────────────

test('latestFor routes npm rows to the npm source only', async () => {
  const hit = [];
  const v = await latestFor({ kind: 'npm', pkg: 'jscpd' }, {
    npmLatest: () => { hit.push('npm'); return '5.4.3'; },
    pipLatest: async () => { hit.push('pip'); return '9.9.9'; },
    githubLatest: async () => { hit.push('gh'); return '9.9.9'; },
  });
  assert.equal(v, '5.4.3');
  assert.deepEqual(hit, ['npm']);
});

test('latestFor routes pip rows to the pip source only', async () => {
  const hit = [];
  const v = await latestFor({ kind: 'pip', pkg: 'lizard' }, {
    npmLatest: () => { hit.push('npm'); return '1.0.0'; },
    pipLatest: async () => { hit.push('pip'); return '1.17.10'; },
    githubLatest: async () => { hit.push('gh'); return '1.0.0'; },
  });
  assert.equal(v, '1.17.10');
  assert.deepEqual(hit, ['pip']);
});

test('latestFor routes binary rows to the github source only', async () => {
  const hit = [];
  const v = await latestFor({ kind: 'binary', repo: 'a/b' }, {
    npmLatest: () => { hit.push('npm'); return '1.0.0'; },
    pipLatest: async () => { hit.push('pip'); return '1.0.0'; },
    githubLatest: async () => { hit.push('gh'); return '8.18.2'; },
  });
  assert.equal(v, '8.18.2');
  assert.deepEqual(hit, ['gh']);
});

test('latestFor answers empty for a kind with no release channel', async () => {
  // 'node' has no peer version; returning '' is what lets classify treat npx as
  // ok rather than permanently unverified.
  assert.equal(await latestFor({ kind: 'node' }, {}), '');
});

test('latestFor normalises the npm answer through semverOf', async () => {
  const v = await latestFor({ kind: 'npm', pkg: 'x' }, { npmLatest: () => '  v5.4.3\n' });
  assert.equal(v, '5.4.3');
});
