#!/usr/bin/env node
'use strict';

/**
 * prepack.js — Bundle skills into @xp-gate/opencode-plugin before npm publish.
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

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[prepack] SKIP (missing): ${src}`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

function main() {
  const skillsDest = path.join(PLUGIN_ROOT, 'skills');

  // Clean existing skills
  if (fs.existsSync(skillsDest)) {
    fs.rmSync(skillsDest, { recursive: true, force: true });
  }
  fs.mkdirSync(skillsDest, { recursive: true });

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

  console.error(`[prepack] done: ${copied} skills bundled for @xp-gate/opencode-plugin`);
}

main();
