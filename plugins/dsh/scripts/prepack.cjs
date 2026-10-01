#!/usr/bin/env node
'use strict';

/**
 * prepack.cjs — Bundle every repo skill into @boyingliu01/dsh-plugin-xp-gate
 * before npm publish.
 *
 * Skills live in repo-root `skills/`; `plugins/dsh/skills/` is gitignored and
 * populated here so the published tarball is self-contained (mirrors
 * plugins/opencode/scripts/prepack.cjs).
 *
 * The skill list is DISCOVERED, not hardcoded: a hardcoded list silently drifts
 * from the repo (it previously shipped 12 of 13, omitting clipboard-vision, and
 * would need editing on every new skill) — see #448.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const SKIP_FILE_SUFFIXES = ['.lock', '.js.map'];

/** A skill is a directory directly under skills/ that contains a SKILL.md. */
function discoverSkills() {
  const root = path.join(REPO_ROOT, 'skills');
  if (!fs.existsSync(root)) {
    console.error(`[prepack] ERROR: skills directory not found at ${root}`);
    process.exit(1);
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'SKILL.md')))
    .sort();
}

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

  const skills = discoverSkills();
  let copied = 0;
  for (const name of skills) {
    if (copyDir(path.join(REPO_ROOT, 'skills', name), path.join(skillsDest, name))) {
      copied += 1;
      console.error(`[prepack] skills/${name}`);
    }
  }

  if (copied !== skills.length) {
    console.error(`[prepack] ERROR: expected ${skills.length} skills, copied ${copied}`);
    process.exit(1);
  }

  console.error(`[prepack] done: ${copied} skills bundled`);
}

main();