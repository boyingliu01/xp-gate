#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

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

const PLUGINS = ['claude-code', 'opencode', 'qoder'];

// Plugins whose `skills/` subtree is gitignored (build artifact). For these,
// the source-of-truth skill content lives in repo-root `skills/` and must be
// injected during sync so the npm-package mirror is complete even on a clean
// checkout (e.g. CI Mirror Parity job). Plugins not listed here are expected
// to ship their own committed `skills/` subtree (e.g. `plugins/qoder/skills/`).
const PLUGINS_WITH_GITIGNORED_SKILLS = new Set(['claude-code', 'opencode']);

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.opencode']);
const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_FILE_SUFFIXES = ['.lock', '.js.map'];

function shouldSkipFile(name) {
  if (SKIP_FILES.has(name)) return true;
  return SKIP_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[sync] SKIP (missing): ${src}`);
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

function injectCanonicalSkills(pluginDest) {
  const skillsDest = path.join(pluginDest, 'skills');
  rmrf(skillsDest);
  fs.mkdirSync(skillsDest, { recursive: true });
  for (const name of CORE_SKILLS) {
    const src = path.join(REPO_ROOT, 'skills', name);
    const dest = path.join(skillsDest, name);
    if (!copyDir(src, dest)) {
      console.error(`[sync] ERROR: missing canonical skill ${name}`);
      process.exit(1);
    }
  }
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
      if (PLUGINS_WITH_GITIGNORED_SKILLS.has(name)) {
        injectCanonicalSkills(dest);
      }
      copied += 1;
      console.error(`[sync] plugins/${name}`);
    }
  }
  return copied;
}

function syncAdapters() {
  const srcRoot = path.join(REPO_ROOT, 'githooks', 'adapters');
  const destRoot = path.join(PKG_ROOT, 'adapters');
  if (!fs.existsSync(srcRoot)) {
    console.error(`[sync] SKIP adapters (missing): ${srcRoot}`);
    return 0;
  }
  rmrf(destRoot);
  fs.mkdirSync(destRoot, { recursive: true });
  const entries = fs.readdirSync(srcRoot, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    const srcPath = path.join(srcRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
      copied += 1;
    } else if (entry.isFile() && entry.name.endsWith('.sh')) {
      fs.copyFileSync(srcPath, destPath);
      copied += 1;
    }
  }
  console.error(`[sync] adapters/ (${copied} entries)`);
  return copied;
}

function syncModules(moduleName) {
  const src = path.join(REPO_ROOT, 'src', moduleName);
  const dest = path.join(PKG_ROOT, moduleName);
  if (!copyDir(src, dest)) {
    console.error(`[sync] ERROR: missing module ${moduleName}`);
    process.exit(1);
  }
  console.error(`[sync] ${moduleName}/`);
  return 1;
}

/**
 * Docs-drift check (REQ-TDD-005): compare Gate table in README.md against
 * actual gate definitions in githooks/pre-commit and githooks/pre-push.
 * Blocks publish if counts diverge.
 */
function checkDocsDrift() {
  const preCommitScript = path.join(REPO_ROOT, 'githooks', 'pre-commit');
  const prePushScript = path.join(REPO_ROOT, 'githooks', 'pre-push');
  const readme = path.join(REPO_ROOT, 'README.md');

  // Script pattern: lines like `echo "→ Gate 1: Code Quality..."` and `"Gate 0:"`
  let scriptContent = '';
  if (fs.existsSync(preCommitScript)) {
    scriptContent = fs.readFileSync(preCommitScript, 'utf8');
  } else {
    console.error('[drift-check] WARN: githooks/pre-commit not found, skipping pre-commit check');
  }

  const SCRIPT_META_GATES = new Set(['10']);
  const scriptGateNums = new Set();
  for (const m of scriptContent.matchAll(/Gate (\d+):/g)) {
    if (!SCRIPT_META_GATES.has(m[1])) {
      scriptGateNums.add(m[1]);
    }
  }
  let readmeContent = '';
  if (fs.existsSync(readme)) {
    readmeContent = fs.readFileSync(readme, 'utf8');
  } else {
    console.error('[drift-check] WARN: README.md not found, skipping drift check');
    return;
  }

  const readmePreCommitGates = new Set();
  for (const m of readmeContent.matchAll(/\| Gate (\d+) \|/g)) {
    readmePreCommitGates.add(m[1]);
  }

  if (scriptGateNums.size > 0 && readmePreCommitGates.size > 0) {
    const scriptOnly = [...scriptGateNums].filter((g) => !readmePreCommitGates.has(g));
    const readmeOnly = [...readmePreCommitGates].filter((g) => !scriptGateNums.has(g));

    if (scriptOnly.length > 0 || readmeOnly.length > 0) {
      console.error('[drift-check] ERROR: Pre-commit Gate table drift detected!');
      console.error(`  Script githooks/pre-commit has ${scriptGateNums.size} gates: [${[...scriptGateNums].sort((a, b) => +a - +b).join(', ')}]`);
      console.error(`  README.md documents ${readmePreCommitGates.size} gates: [${[...readmePreCommitGates].sort((a, b) => +a - +b).join(', ')}]`);
      if (scriptOnly.length > 0) {
        console.error(`  In script but NOT in README: Gate ${scriptOnly.sort((a, b) => +a - +b).join(', Gate ')}`);
      }
      if (readmeOnly.length > 0) {
        console.error(`  In README but NOT in script: Gate ${readmeOnly.sort((a, b) => +a - +b).join(', Gate ')}`);
      }
      console.error('  Fix: Update README.md Gate table to match githooks/pre-commit');
      process.exit(1);
    }
    console.error(`[drift-check] OK: pre-commit ${scriptGateNums.size} gates match README`);
  }

  let pushScriptContent = '';
  if (fs.existsSync(prePushScript)) {
    pushScriptContent = fs.readFileSync(prePushScript, 'utf8');
  } else {
    console.error('[drift-check] WARN: githooks/pre-push not found, skipping pre-push check');
    return;
  }

  const scriptPushGates = new Set();
  for (const m of pushScriptContent.matchAll(/[Gg][Aa][Tt][Ee] (M\d*)/g)) {
    scriptPushGates.add(m[1]);
  }

  const readmePushGates = new Set();
  for (const m of readmeContent.matchAll(/\| Gate (M\d*) \|/g)) {
    readmePushGates.add(m[1]);
  }

  if (scriptPushGates.size > 0 && readmePushGates.size > 0) {
    const scriptOnly = [...scriptPushGates].filter((g) => !readmePushGates.has(g));
    const readmeOnly = [...readmePushGates].filter((g) => !scriptPushGates.has(g));

    if (scriptOnly.length > 0 || readmeOnly.length > 0) {
      console.error('[drift-check] ERROR: Pre-push Gate table drift detected!');
      console.error(`  Script githooks/pre-push has ${scriptPushGates.size} gates: [${[...scriptPushGates].join(', ')}]`);
      console.error(`  README.md documents ${readmePushGates.size} gates: [${[...readmePushGates].join(', ')}]`);
      if (scriptOnly.length > 0) {
        console.error(`  In script but NOT in README: Gate ${scriptOnly.join(', Gate ')}`);
      }
      if (readmeOnly.length > 0) {
        console.error(`  In README but NOT in script: Gate ${readmeOnly.join(', Gate ')}`);
      }
      console.error('  Fix: Update README.md Gate table to match githooks/pre-push');
      process.exit(1);
    }
    console.error(`[drift-check] OK: pre-push ${scriptPushGates.size} gates match README`);
  }
}

function main() {
  console.error(`[sync] repo root: ${REPO_ROOT}`);
  console.error(`[sync] package root: ${PKG_ROOT}`);
  checkDocsDrift();
  const skills = syncSkills();
  const plugins = syncPlugins();
  const adapters = syncAdapters();
  const principles = syncModules('principles');
  const mutation = syncModules('mutation');
  const mockPolicy = syncModules('mock-policy');
  console.error(`[sync] done: ${skills} skill(s), ${plugins} plugin(s), ${adapters} adapter entries, ${principles + mutation + mockPolicy} module(s)`);
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
