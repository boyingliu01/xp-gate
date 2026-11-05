/**
 * @test REQ-732
 * @intent package-lock.json must track VERSION like every other manifest, so a
 *   version bump cannot silently leave the lockfile advertising an older version.
 * @covers AC-717-29
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SYNC = path.join(ROOT, 'scripts', 'sync-version.cjs');

/**
 * Run the sync script inside a throwaway copy of the files it rewrites.
 * The real script writes into ROOT; running it there during tests would
 * mutate the working tree, so the tree is mirrored into a temp home first.
 */
function runSyncInTempTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-syncver-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });

  const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();

  // A lockfile pinned to a DIFFERENT version than VERSION is the exact drift
  // #741 reported: npm rewrites it on the next install, so it resurfaces as an
  // unexplained diff instead of failing anything.
  const staleLock = {
    name: 'xp-gate',
    version: '0.22.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'xp-gate', version: '0.22.0.0', license: 'MIT' },
    },
  };
  fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify(staleLock, null, 2) + '\n');
  fs.writeFileSync(path.join(tmp, 'VERSION'), version + '\n');
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'xp-gate', version: '0.22.0.0' }, null, 2) + '\n',
  );

  // The script resolves ROOT_DIR from its own location, so copying it into the
  // temp tree makes it operate there without needing an env override.
  fs.copyFileSync(SYNC, path.join(tmp, 'scripts', 'sync-version.cjs'));

  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(tmp, 'scripts', 'sync-version.cjs')], {
    cwd: tmp,
    stdio: 'pipe',
  });

  const written = JSON.parse(fs.readFileSync(path.join(tmp, 'package-lock.json'), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { written, version };
}

test('sync-version rewrites package-lock.json top-level version', () => {
  const { written, version } = runSyncInTempTree();
  assert.strictEqual(written.version, version);
});

test('sync-version rewrites the duplicated packages[""] version in the lockfile', () => {
  // npm stores the root manifest's version twice; updating only one leaves the
  // pair disagreeing and the drift returns on the next `npm install`.
  const { written, version } = runSyncInTempTree();
  assert.strictEqual(written.packages[''].version, version);
});

test('lockfile version is not left at the pre-bump value', () => {
  const { written } = runSyncInTempTree();
  assert.notStrictEqual(written.version, '0.22.0.0');
  assert.notStrictEqual(written.packages[''].version, '0.22.0.0');
});

test('the real repo lockfile agrees with VERSION', () => {
  // The end state this bug produced, asserted against the actual tree rather
  // than a fixture: a lockfile disagreeing with VERSION means the publish is
  // shipping metadata that contradicts itself.
  const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.strictEqual(lock.version, version, 'package-lock.json version != VERSION');
  assert.strictEqual(lock.packages[''].version, version, 'packages[""] version != VERSION');
});
