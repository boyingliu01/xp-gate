#!/usr/bin/env node
/**
 * @test REQ-E1 — the generated mirror reproduces the canonical tree byte-for-byte
 * @intent P1-E step 1 moved `src/npm-package/adapters/` (199 files) out of version
 *         control: it is now produced by `scripts/generate-mirrors.cjs`, which
 *         `prepare` runs on every install and prepack runs before publishing.
 *
 *         That changes what mirror-parity CAN assert. The old check compared two
 *         committed trees; with one committed tree there is nothing to compare, so
 *         the question becomes whether the generator reproduces the canonical tree
 *         exactly. This is a stronger claim, not a weaker one: the old check could
 *         only ever confirm that two copies happened to agree -- and two copies can
 *         be equally wrong, which is what #683 (4953 bytes of stale gate-3.sh) and
 *         v0.27.3 (a mirror-only fix rolled back at the next publish) both were.
 *
 *         The three things that must hold, and they fail independently:
 *
 *         1. REPRODUCIBLE. Generating from a clean canonical tree yields a tree
 *            byte-identical to the canonical one. If the generator silently drops
 *            a file type (it copies directories and `.sh` files; the 255 yml/md/
 *            xml/gradle files under githooks/adapters/plugins/ only survive because
 *            `copyDir` recurses), the published package is missing files nobody
 *            notices until a user cannot lint C code.
 *         2. NOT TRACKED. The mirror must be gitignored. If it drifts back into
 *            version control, "edit the wrong copy" becomes possible again, and the
 *            whole point of the step is that it stops being possible.
 *         3. NON-EMPTY AND COMPLETE. A generator that produces zero files, or
 *            stops at the top level, passes a naive "no diff" check against an
 *            empty directory. The file count is asserted against the canonical
 *            tree, not against a number in this file.
 * @covers REQ-E1
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const childProcess = require('node:child_process');

const { test: nodeTest } = require('node:test');
// Runs under vitest (which injects globals) and under `node --test` (which does
// not). A file that registers only node:test cases reports "No test suite found"
// under vitest, and Gate 5 collects this directory with vitest -- so a one-runner
// file is either a silent skip or a spurious failure, depending who looks.
const it = typeof globalThis.it === 'function' ? globalThis.it : nodeTest;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL = path.join(REPO_ROOT, 'githooks', 'adapters');
const MIRROR = path.join(REPO_ROOT, 'src', 'npm-package', 'adapters');
const GENERATOR = path.join(REPO_ROOT, 'src', 'npm-package', 'scripts', 'generate-mirrors.cjs');

/** Every file under `dir`, relative, posix-normalised, sorted. */
function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

it('REQ-E1-01: the generator reproduces githooks/adapters byte-for-byte', () => {
  const before = listFiles(CANONICAL);
  assert.ok(before.length > 100,
    'the canonical adapter tree must be substantial, got ' + before.length + ' files');

  const run = childProcess.spawnSync(process.execPath, [GENERATOR, '--quiet'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 180000,
  });
  assert.strictEqual(run.status, 0,
    'generate-mirrors.cjs must succeed: ' + String(run.stderr).slice(0, 300));

  assert.ok(fs.existsSync(MIRROR), 'the generator must create src/npm-package/adapters/');

  // Completeness first: a generator that emits a subset passes a per-file
  // comparison that iterates only over what it produced.
  const generated = listFiles(MIRROR);
  assert.deepStrictEqual(generated, before,
    'the generated tree must contain exactly the canonical file set, no more and no fewer');

  const mismatched = [];
  for (const relative of before) {
    const a = fs.readFileSync(path.join(CANONICAL, relative));
    const b = fs.readFileSync(path.join(MIRROR, relative));
    if (!a.equals(b)) mismatched.push(relative);
  }
  assert.deepStrictEqual(mismatched, [],
    'these files were not reproduced byte-for-byte: ' + JSON.stringify(mismatched.slice(0, 10)));
});

it('REQ-E1-02: the generated mirror is not tracked by git', () => {
  // If it comes back into version control, the second copy becomes editable again
  // and the defect class this step removes returns with no test to notice.
  const tracked = childProcess.execFileSync('git', ['ls-files', 'src/npm-package/adapters'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  }).trim();
  assert.strictEqual(tracked, '',
    'src/npm-package/adapters/ must not be tracked; found: ' + tracked.split('\n').slice(0, 5).join(', '));

  // And it must be ignored positively, not merely untracked -- an untracked
  // directory shows up in `git status` as noise and invites `git add -A`.
  const ignored = childProcess.spawnSync('git', ['check-ignore', '-q', 'src/npm-package/adapters'], {
    cwd: REPO_ROOT,
  });
  assert.strictEqual(ignored.status, 0, 'src/npm-package/adapters/ must be gitignored');
});

it('REQ-E1-03: publishing still ships the adapters', () => {
  // The mirror exists to be packed. Moving it out of git is only safe while
  // package.json still lists it and prepack still runs the sync -- otherwise the
  // tarball silently ships without adapters and every consumer loses linting.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src', 'npm-package', 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('adapters/'),
    'package.json files[] must still include adapters/, got ' + JSON.stringify(pkg.files));

  const prepack = String(pkg.scripts.prepack || '');
  assert.match(prepack, /sync-package-content\.js/,
    'prepack must still run the mirror sync, got: ' + prepack);

  // `prepare` keeps the mirror present for development and tests, which read it
  // without running prepack.
  assert.match(String(pkg.scripts.prepare || ''), /generate-mirrors\.cjs/,
    'prepare must generate the mirrors so a fresh clone can run the test suite');
});
