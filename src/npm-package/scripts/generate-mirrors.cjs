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
 *         P1-E step 2 adds the three trees that were still committed twice and are
 *         already byte-identical mirrors: `hooks/lib/` (21), `build-integrity/`
 *         (9) and `skills/` (67). Same argument, same contract, 97 more files that
 *         stop having an editorial second copy.
 *
 *         `src/principles/` is NOT here yet, and the omission is deliberate: it is
 *         still being edited in place by another workstream, and two producers
 *         writing one tree means the content depends on which process ran last.
 *         It joins once that work lands.
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
  { mirror: 'adapters', canonical: path.join(REPO_ROOT, 'githooks', 'adapters'), sync: 'adapters' },
  { mirror: 'hooks/lib', canonical: path.join(REPO_ROOT, 'githooks', 'lib'), sync: 'hooks' },
  { mirror: 'build-integrity', canonical: path.join(REPO_ROOT, 'src', 'build-integrity'), sync: 'module' },
  { mirror: 'skills', canonical: path.join(REPO_ROOT, 'skills'), sync: 'skills' },
  // These two shipped in the package's `files[]` and were maintained by hand: no
  // generator knew about them, so they were the last mirror pairs whose "edit the
  // right copy" depended on memory. Same shape as build-integrity, so `module`.
  { mirror: 'mutation', canonical: path.join(REPO_ROOT, 'src', 'mutation'), sync: 'module' },
  { mirror: 'mock-policy', canonical: path.join(REPO_ROOT, 'src', 'mock-policy'), sync: 'module' },
  // P1-E step 4. Long deferred because it was edited in place by another
  // workstream; that work has landed. `sync-package-content.js` already produced
  // this tree at prepack, so adding it here changes nothing about what ships --
  // only whether the tree is generated on demand and therefore safe to untrack.
  { mirror: 'principles', canonical: path.join(REPO_ROOT, 'src', 'principles'), sync: 'module' },
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

  // The canonical source of `adapters` is the tree this module was built for, so
  // its absence is a defect in the checkout and fails. The other three are
  // best-effort: `prepare` runs on every `npm install`, including from a sdist-less
  // checkout where a sibling tree may legitimately be absent, and an install must
  // not fail because of that. It must not SILENTLY SKIP either -- a package that
  // ships without the files it promises is worse than a loud warning.
  const REQUIRED = 'adapters';
  const failures = [];
  let syncSkillsHook;
  let syncAdaptersHook;
  let syncModulesHook;
  let syncHooksHook;

  try {
    // Required lazily: sync-package-content.js runs its own main at require-time
    // when invoked directly, and the eager import would make every caller pay for
    // the skills/plugin discovery even when only the adapters mirror is wanted.
    const mod = require('./sync-package-content.js');
    syncAdaptersHook = mod.syncAdapters;
    syncModulesHook = mod.syncModules;
    syncSkillsHook = mod.syncSkills;
    syncHooksHook = mod.syncHooks;
  } catch (error) {
    process.stderr.write(`[generate-mirrors] cannot load sync-package-content.js: ${error.message}\n`);
    return 1;
  }

  for (const tree of GENERATED_TREES) {
    if (!fs.existsSync(tree.canonical)) {
      if (tree.mirror === REQUIRED) {
        process.stderr.write(
          `[generate-mirrors] CANNOT GENERATE: canonical tree missing: ${tree.canonical}\n`
            + '  The package would build without its adapters. Refusing to continue '
            + 'silently -- a package missing the files it ships is the failure this\n'
            + '  generator exists to prevent.\n',
        );
        return 1;
      }
      process.stderr.write(
        `[generate-mirrors] WARNING: canonical tree missing, skipping ${tree.mirror}/: ${tree.canonical}\n`
          + '  The published package would be missing these files. This is tolerated '
          + 'only because `prepare` runs on installs from partial checkouts.\n',
      );
      failures.push(tree.mirror);
      continue;
    }

    let produced = 0;
    try {
      if (tree.sync === 'adapters') {
        syncAdaptersHook();
        produced = 1;
      } else if (tree.sync === 'hooks') {
        // syncHooks copies githooks/* plus the whole githooks/lib/ subtree.
        syncHooksHook();
        produced = 1;
      } else if (tree.sync === 'module') {
        produced = syncModulesHook(tree.mirror);
      } else if (tree.sync === 'skills') {
        syncSkillsHook();
        produced = 1;
      }
    } catch (error) {
      process.stderr.write(`[generate-mirrors] ERROR generating ${tree.mirror}/: ${error.message}\n`);
      return 1;
    }

    if (!produced) {
      process.stderr.write(`[generate-mirrors] ERROR: sync for ${tree.mirror}/ reported nothing copied\n`);
      return 1;
    }

    const mirrorDir = tree.mirror === 'hooks/lib'
      ? path.join(PKG_ROOT, 'hooks', 'lib')
      : path.join(PKG_ROOT, tree.mirror);
    const files = countFiles(mirrorDir);
    if (files === 0) {
      process.stderr.write(`[generate-mirrors] ERROR: ${tree.mirror}/ generated 0 files from ${tree.canonical}\n`);
      return 1;
    }
    say(`[generate-mirrors] ${tree.mirror}/ (${files} files)`);
  }

  if (failures.length > 0) say(`[generate-mirrors] best-effort trees skipped: ${failures.join(', ')}`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, GENERATED_TREES, countFiles };
