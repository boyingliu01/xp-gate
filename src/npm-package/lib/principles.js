'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolves repo root for the installed xp-gate npm package, or the development
// checkout when running from source. Walks up looking for either:
//   - src/principles/index.ts (this repo / dev mode)
//   - ../../src/principles/index.ts (installed under node_modules/@boyingliu01/xp-gate)
function findPrinciplesEntry() {
  const candidates = [
    // npm package bundled layout: lib/principles.js → principles/index.ts
    path.resolve(__dirname, '..', 'principles', 'index.ts'),
    // Development layout: lib/principles.js → src/principles/index.ts
    path.resolve(__dirname, '..', '..', '..', 'src', 'principles', 'index.ts'),
    // npm package installed under node_modules/@boyingliu01/xp-gate
    path.resolve(__dirname, '..', '..', 'src', 'principles', 'index.ts'),
    // Running from repo root
    path.resolve(process.cwd(), 'src', 'principles', 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Extensions the principles engine has an adapter for. Kept as a literal rather
// than imported from src/principles/analyzer.ts because this file must stay
// loadable by plain Node with no transpile step (the package ships zero runtime
// dependencies and no build). Must match `getAdapterForFile`'s adapterMap.
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.kt', '.kts',
  '.dart', '.swift', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.m', '.mm',
]);

// Directories never worth walking: they hold no project source and can be
// enormous. `node_modules` alone is ~hundreds of MB in this repo.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.stryker-tmp', '.worktrees', '__pycache__', '.venv', 'venv',
]);

/**
 * Walk a directory and collect every source file the engine can analyse.
 *
 * Exported for tests: the walk is the part that used to be silently absent, so
 * it is worth asserting directly rather than only through the CLI.
 *
 * @param {string} dir - absolute or relative directory
 * @returns {string[]} absolute paths, in discovery order
 */
function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // An unreadable directory contributes nothing, but must not crash the run.
    console.error(`[xp-gate principles] cannot read directory ${dir}: ${err.message}`);
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectSourceFiles(abs));
      continue;
    }
    if (!entry.isFile()) continue;
    // Skip test files: their assertions legitimately look like magic numbers,
    // long functions and missing error handling, so including them would bury
    // the real findings in noise.
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(abs);
  }
  return out;
}

/**
 * Turn CLI targets into the flat file list the checker understands (#565).
 *
 * `principles-checker --files` only accepts file paths; a directory matches no
 * adapter extension and is dropped silently, which used to report
 * "No violations found / Files checked: 0" with exit code 0. Expanding here
 * keeps that contract in the layer that advertises `<file_or_directory>`.
 *
 * A file target is returned untouched even if its extension is unknown, so the
 * caller can still surface the checker's own opinion about it.
 *
 * @param {string[]} targets - paths as given on the command line
 * @returns {string[]} file paths to hand to the checker
 */
function expandTargets(targets) {
  const out = [];
  for (const target of targets) {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      // Nonexistent path: forward it so the checker reports the missing file
      // rather than this layer pretending it was fine.
      out.push(target);
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(target));
    } else {
      out.push(target);
    }
  }
  return out;
}

function principles(args) {
  const target = args[0];
  if (!target) {
    console.error('Usage: xp-gate principles <file_or_directory> [--format console|json|sarif]');
    return Promise.resolve(1);
  }

  const formatIdx = args.indexOf('--format');
  const format = formatIdx >= 0 ? args[formatIdx + 1] : 'console';

  // Expand directories before handing them to the checker (#565). Passing a
  // directory straight through made the checker examine zero files while the
  // CLI printed "No violations found" and exited 0.
  const files = expandTargets([target]);
  if (files.length === 0) {
    // Nothing to analyse is NOT a pass. Saying so is the whole point: silence
    // here is indistinguishable from a clean directory. Exit 2 mirrors the
    // checker's own "examined nothing" contract, which reserves 1 for
    // "examined files and found violations".
    console.error(`[xp-gate principles] no analysable source files under: ${target}`);
    console.error('  Supported: ' + Array.from(SOURCE_EXTENSIONS).join(' '));
    return Promise.resolve(2);
  }

  const entry = findPrinciplesEntry();
  if (!entry) {
    console.error('[xp-gate principles] ERROR: cannot locate src/principles/index.ts');
    console.error('  Run from inside the xp-gate repo, or install via npm install -g @boyingliu01/xp-gate');
    return Promise.resolve(1);
  }

  const result = spawnSync('npx', ['-y', 'tsx', entry, '--files', files.join(' '), '--format', format], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return Promise.resolve(result.status === null ? 1 : result.status);
}

module.exports = { principles, expandTargets, collectSourceFiles };
