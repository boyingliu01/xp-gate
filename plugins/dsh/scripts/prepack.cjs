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
 * from the repo (a hardcoded set previously omitted one shipped skill, breaking
 * parity) — see #448.
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
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => fs.existsSync(path.join(root, name, 'SKILL.md')))
      .sort();
  } catch (err) {
    // Packaging with NO skills would produce a plugin that loads but offers nothing.
    console.error(`[prepack] ERROR: cannot read ${root}: ${err.message}`);
    process.exit(1);
  }
}

function shouldSkipFile(name) {
  return SKIP_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
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

function main() {
  const skillsDest = path.join(PLUGIN_ROOT, 'skills');
  try {
    fs.rmSync(skillsDest, { recursive: true, force: true });
    fs.mkdirSync(skillsDest, { recursive: true });
  } catch (err) {
    console.error(`[prepack] ERROR: cannot prepare ${skillsDest}: ${err.message}`);
    process.exit(1);
  }

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