#!/usr/bin/env node
'use strict';

/**
 * prepack.cjs — Bundle the 12 repo skills into @boyingliu01/dsh-plugin-xp-gate
 * before npm publish.
 *
 * Skills live in repo-root `skills/`; `plugins/dsh/skills/` is gitignored and
 * populated here so the published tarball is self-contained (mirrors
 * plugins/opencode/scripts/prepack.cjs).
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');

const SKILLS = [
  'admin-template-guidelines',
  'batch-grill-me',
  'delphi-review',
  'domain-modeling',
  'grilling',
  'grill-with-docs',
  'improve-codebase-architecture',
  'ralph-loop',
  'sprint-flow',
  'test-driven-development',
  'test-specification-alignment',
  'to-issues',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const SKIP_FILE_SUFFIXES = ['.lock', '.js.map'];

function shouldSkipFile(name) {
  return SKIP_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[prepack] SKIP (missing): ${src}`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
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
  fs.rmSync(skillsDest, { recursive: true, force: true });
  fs.mkdirSync(skillsDest, { recursive: true });

  let copied = 0;
  for (const name of SKILLS) {
    if (copyDir(path.join(REPO_ROOT, 'skills', name), path.join(skillsDest, name))) {
      copied += 1;
      console.error(`[prepack] skills/${name}`);
    }
  }

  if (copied !== SKILLS.length) {
    console.error(`[prepack] ERROR: expected ${SKILLS.length} skills, copied ${copied}`);
    process.exit(1);
  }

  console.error(`[prepack] done: ${copied} skills bundled`);
}

main();