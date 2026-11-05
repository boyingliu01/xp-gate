/**
 * @test REQ-732
 * @intent package-lock.json must track VERSION like every other manifest, so a
 *   version bump cannot silently leave the lockfile advertising an older version.
 * @covers AC-717-29
 */
'use strict';

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
  try {
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
    return { written, version };
  } finally {
    // `finally` rather than a trailing rmSync: an assertion or a failed spawn
    // above would otherwise leave the directory behind on every CI run.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('sync-version / package-lock.json', () => {
  it('rewrites the lockfile top-level version', () => {
    const { written, version } = runSyncInTempTree();
    expect(written.version).toBe(version);
  });

  it('rewrites the duplicated packages[""] version in the lockfile', () => {
    // npm stores the root manifest's version twice; updating only one leaves the
    // pair disagreeing and the drift returns on the next `npm install`.
    const { written, version } = runSyncInTempTree();
    expect(written.packages[''].version).toBe(version);
  });

  it('is not left at the pre-bump value', () => {
    const { written } = runSyncInTempTree();
    expect(written.version).not.toBe('0.22.0.0');
    expect(written.packages[''].version).not.toBe('0.22.0.0');
  });

  it('the real repo lockfile agrees with VERSION', () => {
    // The end state this bug produced, asserted against the actual tree rather
    // than a fixture: a lockfile disagreeing with VERSION means the publish is
    // shipping metadata that contradicts itself.
    const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    // Compared as an object so a failure names WHICH copy drifted. Two separate
    // assertions would report "expected 0.36.0.0 to be 0.22.0.0" with no hint
    // that it is the top-level field rather than packages[""] that disagrees.
    const observed = { topLevel: lock.version, 'packages[""]': lock.packages[''].version };
    expect(observed).toStrictEqual({ topLevel: version, 'packages[""]': version });
  });
});
