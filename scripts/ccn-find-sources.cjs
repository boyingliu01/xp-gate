'use strict';
/**
 * Which files the complexity report measures.
 *
 * Split out of `ccn-report.cjs` when that file crossed its size ceiling. This is the
 * INCLUSION rule -- the one place that decides what "production code" means for every
 * number the rest of the tool produces.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Extensions the report measures. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|cpp|cc|c|h|hpp|m|mm|dart|php|phtml)$/i;

function findSourceFiles(root) {
  const out = [];
  // #731: `vendor` is composer's dependency tree, and it is NOT gitignored by
  // default in PHP projects -- a committed vendor/ (which composer recommends
  // for applications) is tracked, so the `tracked` filter below does not exclude
  // it. Measured while onboarding PHP: a two-file fixture with a normal
  // composer install produced baseline rows for
  // `vendor/phpunit/php-code-coverage/.../bootstrap.bundle.min.js`, i.e. a third
  // party's minified JS was being graded as the project's own production code.
  // Same reasoning as node_modules; the name is just spelled differently.
  const tracked = trackedFiles(root);
  walkSources(root, root, tracked, out);
  return out;
}

/**
 * Directories the scan never descends into.
 *
 * `vendor` is composer's dependency tree and is NOT gitignored by default in PHP
 * projects, so the tracked filter below does not exclude it. Measured while onboarding
 * PHP: a normal `composer install` produced baseline rows for a third party's MINIFIED
 * JS, graded as the project's own production code (#731).
 */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'vendor', '.worktrees', '.codegraph', '.sprint-state', '.xp-gate',
]);

/**
 * The set of git-tracked paths, or null outside a repository.
 *
 * Untracked files are not repo content: scratch dirs, `.stryker-tmp` sandboxes and
 * `.qoder` reports would otherwise flood the report with phantom "production" functions
 * that no gate can even see. Null (not an empty set) is what tells the walker to keep
 * everything, which is the right answer when git cannot be asked.
 */
/**
 * The normalised paths in a `git ls-files` listing.
 *
 * Normalised because the walker compares these against paths built with `path.join`,
 * and on a platform where the two differ in separator a raw comparison silently matches
 * nothing -- which would report an empty production tree.
 */
function listedPaths(listing) {
  return listing.split(/\r?\n/).filter(Boolean).map((p) => path.normalize(p));
}

function trackedFiles(root) {
  try {
    const listing = execFileSync('git', ['ls-files'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return new Set(listedPaths(listing));
  } catch {
    // Outside a git repo: fall back to walking everything.
    return null;
  }
}

/** Whether this relative path belongs in the report. */
function isReportable(rel, tracked) {
  return !tracked || tracked.has(path.normalize(rel));
}

/**
 * Collect the source files under `dir`, recursively.
 *
 * An unreadable directory is skipped rather than fatal: the scan is a report, and one
 * permission-denied subtree must not void the whole result.
 */
function walkSources(root, dir, tracked, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSources(root, full, tracked, out);
    } else if (SOURCE_EXT.test(e.name)) {
      const rel = path.relative(root, full);
      if (isReportable(rel, tracked)) out.push(rel);
    }
  }
}

module.exports = { findSourceFiles, SOURCE_EXT };
