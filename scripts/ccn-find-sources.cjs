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
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'vendor', '.worktrees', '.codegraph', '.sprint-state', '.xp-gate']);
  // Git-untracked files are not repo content: scratch dirs, .stryker-tmp
  // sandboxes and .qoder reports would otherwise flood the report with
  // phantom "production" functions that no gate can even see.
  let tracked = null;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((p) => path.normalize(p))
    );
  } catch { /* outside a git repo: fall back to walking everything */ }
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (SOURCE_EXT.test(e.name)) {
        const rel = path.relative(root, full);
        if (!tracked || tracked.has(path.normalize(rel))) out.push(rel);
      }
    }
  })(root);
  return out;
}

module.exports = { findSourceFiles, SOURCE_EXT };
