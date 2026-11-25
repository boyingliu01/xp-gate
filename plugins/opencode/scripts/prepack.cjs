#!/usr/bin/env node
'use strict';

/**
 * prepack.js — Bundle skills into @boyingliu01/opencode-plugin before npm publish.
 *
 * Skills live in repo-root `skills/` and are gitignored in `plugins/opencode/skills/`.
 * This script copies them into the plugin package so the published tarball is self-contained.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');

const CORE_SKILLS = [
  'admin-template-guidelines',
  'delphi-review',
  'improve-codebase-architecture',
  'ralph-loop',
  'sprint-flow',
  'test-driven-development',
  'test-specification-alignment',
  'to-issues',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.opencode']);
const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_FILE_SUFFIXES = ['.lock', '.js.map'];

function shouldSkipFile(name) {
  if (SKIP_FILES.has(name)) return true;
  return SKIP_FILE_SUFFIXES.some(suffix => name.endsWith(suffix));
}

/**
 * Copy one directory entry.
 *
 * A directory is descended into, a file is copied unless its suffix is skipped, and
 * anything else (a symlink, a socket) is left alone -- `copyFileSync` on those would
 * either fail or copy something the package must not contain.
 */
function copyEntry(entry, src, dest) {
  if (SKIP_DIRS.has(entry.name)) return;
  const srcPath = path.join(src, entry.name);
  const destPath = path.join(dest, entry.name);
  if (entry.isDirectory()) copyDir(srcPath, destPath);
  else if (entry.isFile() && !shouldSkipFile(entry.name)) fs.copyFileSync(srcPath, destPath);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[prepack] SKIP (missing): ${src}`);
    return false;
  }
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyEntry(entry, src, dest);
    }
  } catch (err) {
    // A partial copy is WORSE than none: the package would ship a plugin with some of
    // its skills, and the missing ones only surface at load time.
    console.error(`[prepack] FAILED to copy ${src} -> ${dest}: ${err.message}`);
    return false;
  }
  return true;
}

/**
 * Recreate the destination empty.
 *
 * Guarded because a failure here would leave the destination half-emptied, and the copy
 * that follows would then look like it succeeded.
 */
function prepareSkillsDir(skillsDest) {
  try {
    if (fs.existsSync(skillsDest)) fs.rmSync(skillsDest, { recursive: true, force: true });
    fs.mkdirSync(skillsDest, { recursive: true });
  } catch (err) {
    console.error(`[prepack] ERROR: cannot prepare ${skillsDest}: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const skillsDest = path.join(PLUGIN_ROOT, 'skills');

  prepareSkillsDir(skillsDest);

  let copied = 0;
  for (const name of CORE_SKILLS) {
    const src = path.join(REPO_ROOT, 'skills', name);
    const dest = path.join(skillsDest, name);
    if (copyDir(src, dest)) {
      copied += 1;
      console.error(`[prepack] skills/${name}`);
    }
  }

  if (copied !== CORE_SKILLS.length) {
    console.error(`[prepack] ERROR: expected ${CORE_SKILLS.length} skills, copied ${copied}`);
    process.exit(1);
  }

  console.error(`[prepack] done: ${copied} skills bundled for @boyingliu01/opencode-plugin`);
}

main();
