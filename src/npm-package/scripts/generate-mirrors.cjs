#!/usr/bin/env node
/**
 * @module generate-mirrors
 * @test REQ-E1
 * @intent Generate the npm package's mirror trees from their canonical sources.
 *
 *         WHY THIS EXISTS. `src/npm-package/` must be self-contained: npm's `files`
 *         field cannot point at `../../githooks/`, so the published tarball
 *         unavoidably carries copies. What is optional is whether those copies are
 *         also in git. Keeping them there meant 416 files / 48167 lines of
 *         byte-identical duplication, and every one of them a place to edit by
 *         mistake: #683 shipped a 4953-byte-stale gate-3.sh, v0.27.3 shipped a
 *         mirror-only fix that the next publish rolled back, and #717 sent a C#
 *         SAST fix into a file no hook sourced.
 *
 *         P1-E step 1 moves the largest tree (`adapters/`, 199 files) out of
 *         version control. Once it is generated, "edit the wrong copy" stops being
 *         detectable-but-possible and becomes physically impossible: there is no
 *         second copy to edit until a build creates one.
 *
 *         THE CONTRACT, and it is the whole correctness argument: generating from a
 *         clean canonical tree must reproduce the previously committed mirror
 *         byte-for-byte. That is what mirror-parity now asserts, and it is a
 *         stronger claim than "the two committed trees are equal" -- the old check
 *         could only ever confirm that two copies happened to agree, while the new
 *         one tests the generator itself.
 *
 *         WHY A WRAPPER AND NOT THE SYNC SCRIPT DIRECTLY. `prepare` runs on every
 *         `npm install`, including on machines where `plugins/dsh/lib/` has not been
 *         built, and `sync-package-content.js` aborts in that case with
 *         "[sync] ERROR: plugins/dsh/lib/index.js is missing". An install must not
 *         fail because a gitignored build artefact is absent -- but a missing
 *         adapter tree is worse than a failed install, because the package would
 *         then be built with the tree missing entirely.
 *
 *         So: generate the mirrors that cannot fail (adapters first, the one this
 *         step owns), and treat the rest as best-effort with a visible warning. A
 *         silent skip here would recreate the exact failure this module exists to
 *         remove -- a package that ships without the files it promises.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

/** Mirrors generated here, each with the canonical tree it comes from. */
const GENERATED_TREES = Object.freeze([
  { mirror: 'adapters', canonical: path.join(REPO_ROOT, 'githooks', 'adapters') },
]);

function quiet(argv) {
  return argv.includes('--quiet');
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += 1;
    }
  };
  walk(dir);
  return total;
}

function main(argv = process.argv.slice(2)) {
  const silent = quiet(argv);
  const say = (message) => {
    if (!silent) process.stderr.write(`${message}\n`);
  };

  // 1. The tree this step owns. Absence of the canonical source is a defect in the
  //    checkout, not a normal state, so it fails rather than skipping.
  const [{ mirror, canonical }] = GENERATED_TREES;
  if (!fs.existsSync(canonical)) {
    process.stderr.write(
      `[generate-mirrors] CANNOT GENERATE: canonical tree missing: ${canonical}\n`
        + '  The package would build without its adapters. Refusing to continue '
        + 'silently -- a package missing the files it ships is the failure this\n'
        + '  generator exists to prevent.\n',
    );
    return 1;
  }

  let sync;
  try {
    // Required lazily: the module exports functions rather than running at
    // require-time precisely so that importing it never mutates the work tree.
    // eslint-disable-next-line global-require
    ({ syncAdapters: sync } = require('./sync-package-content.js'));
  } catch (error) {
    process.stderr.write(`[generate-mirrors] cannot load sync-package-content.js: ${error.message}\n`);
    return 1;
  }

  if (typeof sync !== 'function') {
    process.stderr.write('[generate-mirrors] sync-package-content.js does not export syncAdapters\n');
    return 1;
  }

  const entries = sync();
  const files = countFiles(path.join(PKG_ROOT, mirror));
  if (files === 0) {
    process.stderr.write(`[generate-mirrors] ERROR: ${mirror}/ generated 0 files from ${canonical}\n`);
    return 1;
  }
  say(`[generate-mirrors] ${mirror}/ (${entries} entries, ${files} files)`);

  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, GENERATED_TREES, countFiles };
