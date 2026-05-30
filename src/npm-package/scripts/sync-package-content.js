#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

const CORE_SKILLS = [
  'sprint-flow',
  'delphi-review',
  'test-specification-alignment',
  'ralph-loop',
];

const PLUGINS = ['claude-code'];

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[sync] SKIP (missing): ${src}`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

function syncSkills() {
  const destRoot = path.join(PKG_ROOT, 'skills');
  rmrf(destRoot);
  fs.mkdirSync(destRoot, { recursive: true });
  let copied = 0;
  for (const name of CORE_SKILLS) {
    const src = path.join(REPO_ROOT, 'skills', name);
    const dest = path.join(destRoot, name);
    if (copyDir(src, dest)) {
      copied += 1;
      console.error(`[sync] skills/${name}`);
    }
  }
  return copied;
}

function syncPlugins() {
  const destRoot = path.join(PKG_ROOT, 'plugins');
  rmrf(destRoot);
  fs.mkdirSync(destRoot, { recursive: true });
  let copied = 0;
  for (const name of PLUGINS) {
    const src = path.join(REPO_ROOT, 'plugins', name);
    const dest = path.join(destRoot, name);
    if (copyDir(src, dest)) {
      copied += 1;
      console.error(`[sync] plugins/${name}`);
    }
  }
  return copied;
}

function main() {
  console.error(`[sync] repo root: ${REPO_ROOT}`);
  console.error(`[sync] package root: ${PKG_ROOT}`);
  const skills = syncSkills();
  const plugins = syncPlugins();
  console.error(`[sync] done: ${skills} skill(s), ${plugins} plugin(s)`);
  if (skills !== CORE_SKILLS.length) {
    console.error(`[sync] ERROR: expected ${CORE_SKILLS.length} skills, copied ${skills}`);
    process.exit(1);
  }
  if (plugins !== PLUGINS.length) {
    console.error(`[sync] ERROR: expected ${PLUGINS.length} plugins, copied ${plugins}`);
    process.exit(1);
  }
}

main();
