'use strict';

/**
 * Locate tsx's CLI entry by searching UPWARD for node_modules.
 *
 * Why not a fixed number of `..` segments: the depth from a call site to the
 * package root differs between a global install, a local install and a monorepo
 * checkout, and it changes whenever the file moves. #817 was exactly that --
 * `bin/xp-gate.js` used three `..` segments from `bin/`, which already reached
 * `<global>/node_modules`, then appended `node_modules/tsx` again, producing
 * `<global>/node_modules/node_modules/tsx/dist/cli.mjs`. That path can never
 * exist, so `xp-gate audit --check` reported MODULE_NOT_FOUND on every global
 * install.
 *
 * Searching upward is what Node's own resolver does, so it is correct by
 * construction for every layout: the first directory whose `node_modules`
 * contains `tsx/dist/cli.mjs` is the one that wins.
 *
 * A `tsx/` directory without `dist/cli.mjs` counts as "not installed" -- the same
 * convention `gate-runner.js` already uses. A half-written install would
 * otherwise be spawned and fail with a message about missing files, which reads
 * like a defect in the gate rather than an incomplete install.
 */

/** How many ancestor directories to inspect before giving up. */
const MAX_SEARCH_DEPTH = 12;

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} startDir directory to start searching from
 * @returns {string|null} absolute path to tsx's cli.mjs, or null when absent
 */
function findTsxCliFrom(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    // Reached the filesystem root; `dirname(root) === root`.
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

module.exports = { findTsxCliFrom, MAX_SEARCH_DEPTH };
