#!/usr/bin/env node
/**
 * @test REQ-GATE12-VENDOR — file hygiene must not read vendored dependency docs as project source
 * @intent The "First Commit Gates" CI job builds a fresh `git init` fixture, runs
 *         `install.sh`, and commits with a forced add. Forced add stages every
 *         `node_modules/` file, and third-party packages legitimately CONTAIN
 *         `<<<<<<<` text as documentation -- semver/README.md explains conflict
 *         markers, several NOTICE.txt files quote them.
 *
 *         Gate 12 scanned those staged paths and reported:
 *
 *           Merge conflict markers detected in:
 *             - node_modules/@typescript/typescript-linux-x64/NOTICE.txt
 *             - node_modules/semver/README.md
 *
 *         ...blocking the fixture commit on every commit. The failure predates
 *         this change (it fails identically on the two commits before the fix) and
 *         had become background red everyone learned to ignore -- which is how a
 *         real conflict marker would eventually have been missed.
 *
 *         A hygiene check that reads vendored documentation as a conflict is not
 *         finding anything. Same class as the __pycache__ filter in
 *         check-hook-mirror.sh (#587): dependency and build artefacts are not
 *         project source and must not be judged as it.
 * @covers REQ-GATE12-VENDOR
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const childProcess = require('node:child_process');

const { test: nodeTest } = require('node:test');
const it = typeof globalThis.it === 'function' ? globalThis.it : nodeTest;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GATE = path.join(REPO_ROOT, 'githooks', 'gate-12-file-hygiene.sh');
const source = fs.readFileSync(GATE, 'utf8');

it('REQ-GATE12-VENDOR-01: vendored and build directories are excluded from the staged set', () => {
  // Asserted on the assignment text itself: the behavioural case below only
  // covers the patterns that happen to exist on this host.
  const start = source.indexOf('STAGED_FILES=$(git diff --cached');
  assert.ok(start >= 0, 'expected STAGED_FILES to be derived from the staged diff');
  // Plain substring checks rather than a constructed RegExp: the expression is a
  // grep -vE alternation spanning two lines, and a regex built here would be more
  // fragile than the thing it verifies.
  const assignment = source.slice(start, start + 400);
  for (const dir of ['node_modules', 'stryker-tmp', 'vendor']) {
    assert.ok(
      assignment.includes(dir),
      dir + ' must be excluded from the staged file set, or its vendored contents'
        + ' are judged as project source. Got: ' + assignment,
    );
  }
});

/**
 * Run the REAL gate against a fresh git fixture.
 *
 * Deliberately a standalone harness with stubs for the hook helpers the gate
 * sources: importing the whole pre-commit chain to test one gate would be as
 * fragile as the hook it guards.
 */
function runGate(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate12-vendor-'));
  const git = (args) => childProcess.spawnSync('git', args, {
    cwd: dir, encoding: 'utf8', timeout: 60000,
  });

  try {
    git(['init', '-q', '-b', 'fixture']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fixture(dir);
    // `-f` mirrors the CI fixture's forced add, which is what stages the vendored
    // tree in the first place.
    git(['add', '-A', '-f']);

    const script = [
      'gate_start_ms() { echo 0; }',
      'record_gate_audit() { :; }',
      'is_binary_staged_file() { return 1; }',
      '. "$GATE_PATH"',
      'echo "GATE12_STATUS=$GATE_12_STATUS"',
      'echo "GATE12_ISSUES=${HYGIENE_ISSUES:-0}"',
    ].join('\n');

    const result = childProcess.spawnSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120000,
      env: Object.assign({}, process.env, { GATE_PATH: GATE }),
    });
    return String(result.stdout) + String(result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

it('REQ-GATE12-VENDOR-02: the gate passes on vendored docs and still blocks real markers', () => {
  // 1. A conflict marker inside vendored documentation must NOT block.
  const vendored = runGate((dir) => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'semver'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'node_modules', 'semver', 'README.md'),
      '# semver\n\nConflict markers look like:\n\n<<<<<<< HEAD\nversion = 1\n'
        + '=======\nversion = 2\n>>>>>>> branch\n',
    );
    fs.writeFileSync(path.join(dir, 'ok.sh'), 'echo ok\n');
  });
  assert.match(
    vendored,
    /GATE12_STATUS=PASS/,
    'vendored documentation must not be read as project source. Output: ' + vendored.slice(-600),
  );
  assert.doesNotMatch(
    vendored,
    /Merge conflict markers detected/,
    'a third-party README quoting conflict markers is not a conflict',
  );

  // 2. Anti-vacuity: a REAL conflict marker in project source must still block.
  //    Without this, "the gate passes" would also be satisfied by a gate that does
  //    nothing at all -- the exact failure mode this whole file exists to prevent.
  //    Mutation-tested both ways: deleting the exclusion turns case 1 red, and
  //    deleting the conflict check turns case 2 red.
  const real = runGate((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'app.js'),
      'const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n=======\nconst b = 3;\n>>>>>>> feature\n',
    );
  });
  assert.match(
    real,
    /Merge conflict markers detected/,
    'a real conflict marker in project source must still be detected. Output: ' + real.slice(-600),
  );
});
