/**
 * @test REQ-PREPUSH-SOURCE-CLASS
 * @intent `githooks/pre-push` skips the whole walkthrough when a push contains
 *         "no source code files". The classifier is a pair of regexes, so the
 *         decision is made by the file's NAME SHAPE -- and a shape accident had
 *         already exempted the most safety-critical script in the repo (the
 *         comment above NON_EXT_SOURCE_RE records that measurement).
 *
 *         The same accident covered every file that decides what ships.
 *         Measured 2026-11-26: each of the following was classified non-source
 *         and skipped the walkthrough entirely.
 *
 *           src/npm-package/package.json   `files` allowlist and `bin` entry
 *           src/npm-package/.npmignore     what the tarball excludes
 *           .github/workflows/*.yml        what CI runs
 *           package-lock.json              the dependency graph
 *
 *         A push that changes only package.json can add a file to the published
 *         tarball or repoint `bin`, and no gate looked at it.
 *
 *         These tests read the real regexes out of githooks/pre-push rather than
 *         copying them, so the suite cannot drift from the script it describes.
 *         They also pin the OTHER direction: genuine documentation must stay
 *         classified as documentation, or the fix would make every README edit
 *         demand a three-model review and the gate would be turned off by the
 *         first person it inconvenienced.
 * @covers AC-PREPUSH-SOURCE-CLASS-01 AC-PREPUSH-SOURCE-CLASS-02
 */
const fs = require('fs');
const path = require('path');

// __tests__ -> scripts -> npm-package -> src -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREPUSH = path.join(REPO_ROOT, 'githooks', 'pre-push');

/**
 * Read an assignment's regex payload out of the pre-push script.
 *
 * The script is bash, so `\.` is a literal dot once the shell has a single-quoted
 * string; JS needs it the same way and can consume it verbatim.
 *
 * @param {string} body whole script text
 * @param {string} name variable name, e.g. NON_EXT_SOURCE_RE
 * @returns {RegExp}
 */
function readRegex(body, name) {
  // The script is inconsistent by hand: SOURCE_EXTENSIONS is double-quoted,
  // NON_EXT_SOURCE_RE single-quoted. Accept either so a later edit that swaps
  // the quoting does not break the suite for the wrong reason.
  const match = body.match(new RegExp(`^${name}=(['"])(.*?)\\1`, 'm'));
  if (!match) throw new Error(`${name} not found in githooks/pre-push`);
  return new RegExp(match[2]);
}

const SCRIPT = fs.readFileSync(PREPUSH, 'utf8');
const SOURCE_EXTENSIONS = readRegex(SCRIPT, 'SOURCE_EXTENSIONS');
const NON_EXT_SOURCE_RE = readRegex(SCRIPT, 'NON_EXT_SOURCE_RE');

/**
 * The script's own predicate, verbatim: a file is source if it matches either
 * regex.
 *
 * @param {string} file repo-relative path
 * @returns {boolean}
 */
function isSource(file) {
  return SOURCE_EXTENSIONS.test(file) || NON_EXT_SOURCE_RE.test(file);
}

describe('REQ-PREPUSH-SOURCE-CLASS a push that ships something is reviewed', () => {
  describe('files that decide what ships are source', () => {
    const shipping = [
      'src/npm-package/package.json',
      'package.json',
      'package-lock.json',
      'src/npm-package/.npmignore',
      '.github/workflows/cross-platform-ci.yml',
      '.github/workflows/tests.yaml',
    ];

    it.each(shipping)('%s requires the walkthrough', (file) => {
      expect(isSource(file), `${file} must not be classified as documentation only`).toBe(true);
    });
  });

  describe('the case that started this: an extensionless hook', () => {
    it.each([
      'githooks/pre-push',
      'githooks/pre-commit',
      'githooks/post-merge',
      'scripts/__tests__/check-hook-mirror-artifacts.test.bats',
    ])('%s requires the walkthrough', (file) => {
      expect(isSource(file)).toBe(true);
    });
  });

  describe('genuine documentation stays documentation', () => {
    // If these start requiring a review, README edits become three-model sweeps
    // and the gate gets switched off. That is a worse outcome than the bug.
    it.each([
      'README.md',
      'docs/guide.md',
      'CHANGELOG.md',
      'LICENSE',
      'CONTRIBUTING.md',
      'docs/diagram.png',
    ])('%s does not require the walkthrough', (file) => {
      expect(isSource(file), `${file} must stay documentation-only`).toBe(false);
    });
  });

  describe('ordinary source is still source', () => {
    it.each([
      'src/npm-package/lib/star-notice.js',
      'src/principles/adapters/java.ts',
      'scripts/check-hook-mirror.sh',
    ])('%s requires the walkthrough', (file) => {
      expect(isSource(file)).toBe(true);
    });
  });
});
