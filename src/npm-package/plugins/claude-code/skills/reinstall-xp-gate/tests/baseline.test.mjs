import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  runsRoot, makeRunDir, snapshotConfig, writeBaseline,
  xpGateInfo, configInfo, delphiInfo, doctorInfo,
} from '../scripts/lib/baseline.mjs';
import { HOME } from '../scripts/lib/proc.mjs';
import { readJson, rmrf } from '../scripts/lib/util.mjs';

test('runsRoot lives outside the xp-gate config dir so purge cannot delete it', () => {
  const root = runsRoot();
  // The entire point of the run directory: it must survive
  // `uninstall --purge`, which removes ~/.config/xp-gate wholesale.
  assert.ok(!root.includes(`${path.sep}.config${path.sep}`), `runsRoot must not be under .config: ${root}`);
  assert.ok(root.startsWith(HOME));
  assert.ok(root.includes('reinstall-runs'));
});

test('makeRunDir creates a timestamped directory under runsRoot', (t) => {
  const dir = makeRunDir();
  t.after(() => rmrf(dir));

  assert.ok(fs.existsSync(dir));
  assert.equal(fs.statSync(dir).isDirectory(), true);
  assert.equal(path.dirname(dir), runsRoot());
  assert.match(path.basename(dir), /^\d{8}-\d{6}$/);
});

test('snapshotConfig returns an array of the config filenames it copied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-snap-'));
  try {
    const copied = snapshotConfig(dir);
    assert.ok(Array.isArray(copied));
    // Only these two are user configuration; everything else is regenerable.
    for (const name of copied) {
      assert.ok(['.delphi-config.json', 'xp-gate.json'].includes(name), `unexpected snapshot: ${name}`);
      assert.equal(fs.existsSync(path.join(dir, name)), true, `copied file missing: ${name}`);
    }
  } finally {
    rmrf(dir);
  }
});

test('writeBaseline writes a readable baseline.json into the run dir', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-base-'));
  try {
    writeBaseline(dir, { createdAt: 'x', platform: 'test' });
    assert.equal(readJson(path.join(dir, 'baseline.json')).platform, 'test');
  } finally {
    rmrf(dir);
  }
});

test('xpGateInfo reports an empty version when no package is installed', () => {
  const info = xpGateInfo('');
  assert.equal(info.packageDir, '');
  assert.equal(info.version, '');
});

test('xpGateInfo reads the version out of package.json', (t) => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-pkgver-'));
  t.after(() => rmrf(pkg));
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '9.9.9' }));

  const info = xpGateInfo(pkg);
  assert.equal(info.packageDir, pkg);
  assert.equal(info.version, '9.9.9');
});

test('configInfo defaults every field instead of emitting undefined', () => {
  const info = configInfo(null);
  assert.equal(typeof info.mode, 'string');
  assert.equal(typeof info.templateDir, 'string');
  assert.equal(typeof info.hooksPath, 'string');
});

test('delphiInfo uses ?? null so empty values survive as empty', () => {
  // `|| null` here would turn a legitimately empty channels list into "unset",
  // silently changing what the baseline records.
  const info = delphiInfo({ channels: [], pinned_models: null, active_profile: '' });
  assert.deepEqual(info.channels, []);
  assert.equal(info.pinned_models, null);
  assert.equal(info.active_profile, '');

  const empty = delphiInfo(null);
  assert.equal(empty.channels, null);
  assert.equal(empty.pinned_models, null);
  assert.equal(empty.active_profile, null);
});

test('doctorInfo projects the JSON fields when parsing succeeded', () => {
  const info = doctorInfo({ json: { ok: true, issues: [], checks: [1] } });
  assert.deepEqual(info, { ok: true, issues: [], checks: [1] });
});

test('doctorInfo falls back to a truncated stderr when JSON is unavailable', () => {
  const info = doctorInfo({ json: null, stderr: 'x'.repeat(2000) });
  assert.equal('error' in info, true);
  assert.ok(info.error.length <= 500);
});
