#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

const CORE_SKILLS = [
  'admin-template-guidelines',
  'batch-grill-me',
  'delphi-review',
  'domain-modeling',
  'grill-with-docs',
  'grilling',
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
  // In-place copy (no rmrf) to avoid race condition with parallel test readers.
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
  // In-place copy (no rmrf) to avoid race condition with parallel test readers.
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

// tui-plugin.ts was removed in v0.13.0 (slimming). The TUI panel approach
// was abandoned after multiple unsuccessful integration attempts.

function syncPlugins() {
  const destRoot = path.join(PKG_ROOT, 'plugins');
  // In-place copy (no rmrf) to avoid race condition with parallel test readers.
  fs.mkdirSync(destRoot, { recursive: true });
  let copied = 0;
  for (const name of PLUGINS) {
    const src = path.join(REPO_ROOT, 'plugins', name);
    const dest = path.join(destRoot, name);
    if (copyDir(src, dest)) {
      if (PLUGINS_WITH_GITIGNORED_SKILLS.has(name)) {
        injectCanonicalSkills(dest);
      }
      // tui-plugin.ts was removed in v0.13.0 — no import rewriting needed.
      copied += 1;
      console.error(`[sync] plugins/${name}`);
    }
  }
  return copied;
}

function syncScripts() {
  const srcRoot = path.join(REPO_ROOT, 'scripts');
  const destRoot = path.join(PKG_ROOT, 'scripts');
  const scriptsToSync = ['delphi-external-review.cjs'];
  let copied = 0;
  for (const name of scriptsToSync) {
    const src = path.join(srcRoot, name);
    if (fs.existsSync(src)) {
      fs.mkdirSync(destRoot, { recursive: true });
      fs.copyFileSync(src, path.join(destRoot, name));
      copied += 1;
      console.error(`[sync] scripts/${name}`);
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
  // In-place copy (no rmrf) to avoid race condition where parallel tests
  // (e.g. doctor.test.js) read from destRoot during the delete-recreate window.
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

  // Sync gate scripts (gate-*.sh) from githooks/ to package root so they ship
  // with the npm package and can be installed to the global adapter dir.
  const githooksDir = path.join(REPO_ROOT, 'githooks');
  const gateFiles = fs.readdirSync(githooksDir).filter(f =>
    (f.startsWith('gate-') || f === 'sprint-gate.sh') && f.endsWith('.sh')
  );
  for (const f of gateFiles) {
    fs.copyFileSync(path.join(githooksDir, f), path.join(PKG_ROOT, f));
  }
  if (gateFiles.length > 0) {
    console.error(`[sync] gate scripts: ${gateFiles.join(', ')}`);
  }
  return copied + gateFiles.length;
}

function syncHooks() {
  const SRC = path.join(REPO_ROOT, 'githooks');
  const DST = path.join(PKG_ROOT, 'hooks');
  // In-place copy (no rmrf) to avoid race condition with parallel test readers.
  fs.mkdirSync(DST, { recursive: true });

  const adapterCommonSrc = path.join(SRC, 'adapter-common.sh');
  if (fs.existsSync(adapterCommonSrc)) {
    fs.copyFileSync(adapterCommonSrc, path.join(PKG_ROOT, 'adapter-common.sh'));
  }

  const HOOK_FILES = ['pre-commit', 'pre-push', 'adapter-common.sh'];
  let copied = 0;

  for (const name of HOOK_FILES) {
    const srcPath = path.join(SRC, name);
    const dstPath = path.join(DST, name);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
      copied += 1;
    }
  }

  // Copy lib/ subdirectory recursively
  const libSrc = path.join(SRC, 'lib');
  const libDst = path.join(DST, 'lib');
  if (fs.existsSync(libSrc)) {
    fs.rmSync(libDst, { recursive: true, force: true });
    copyDir(libSrc, libDst);
    copied += 1;
  }

  // Copy gate-*.sh files from githooks root to hooks/
  const gateFiles = fs.readdirSync(SRC).filter(f =>
    f.endsWith('.sh') && (f.startsWith('gate-') || f === 'sprint-gate.sh')
  );
  for (const f of gateFiles) {
    fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
  }
  if (gateFiles.length > 0) {
    console.error(`[sync] hooks/ gate scripts: ${gateFiles.join(', ')}`);
    copied += gateFiles.length;
  }

  console.error(`[sync] hooks/ (${copied} entries)`);
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

function extractPreCommitGateNumbers(preCommitContent) {
  const SCRIPT_META_GATES = new Set([]);
  const gates = new Set();
  for (const m of preCommitContent.matchAll(/Gate (\d+):/g)) {
    if (!SCRIPT_META_GATES.has(m[1])) {
      gates.add(m[1]);
    }
  }
  return gates;
}

function extractReadmeGateNumbers(readmeContent, section) {
  const gates = new Set();
  for (const m of readmeContent.matchAll(section)) {
    gates.add(m[1]);
  }
  return gates;
}

function compareGateSets(scriptGates, readmeGates, label, sortFn) {
  const scriptOnly = [...scriptGates].filter((g) => !readmeGates.has(g));
  const readmeOnly = [...readmeGates].filter((g) => !scriptGates.has(g));

  if (scriptOnly.length > 0 || readmeOnly.length > 0) {
    const hookFile = label.toLowerCase();
    console.error(`[drift-check] ERROR: ${label} Gate table drift detected!`);
    const sortedScript = [...scriptGates].sort(sortFn);
    const sortedReadme = [...readmeGates].sort(sortFn);
    console.error(`  Script githooks/${hookFile} has ${scriptGates.size} gates: [${sortedScript.join(', ')}]`);
    console.error(`  README.md documents ${readmeGates.size} gates: [${sortedReadme.join(', ')}]`);
    if (scriptOnly.length > 0) {
      const sorted = sortFn ? scriptOnly.sort(sortFn) : scriptOnly;
      console.error(`  In script but NOT in README: Gate ${sorted.join(', Gate ')}`);
    }
    if (readmeOnly.length > 0) {
      const sorted = sortFn ? readmeOnly.sort(sortFn) : readmeOnly;
      console.error(`  In README but NOT in script: Gate ${sorted.join(', Gate ')}`);
    }
    console.error(`  Fix: Update README.md Gate table to match githooks/${hookFile}`);
  }
  return { scriptOnly, readmeOnly };
}

function checkPreCommitDrift(preCommitPath, readmePath) {
  let scriptContent = '';
  if (fs.existsSync(preCommitPath)) {
    scriptContent = fs.readFileSync(preCommitPath, 'utf8');
  } else {
    console.error('[drift-check] WARN: githooks/pre-commit not found, skipping pre-commit check');
    return null;
  }

  const scriptGates = extractPreCommitGateNumbers(scriptContent);

  let readmeContent = '';
  if (fs.existsSync(readmePath)) {
    readmeContent = fs.readFileSync(readmePath, 'utf8');
  } else {
    console.error('[drift-check] WARN: README.md not found, skipping drift check');
    return true;
  }

  const readmeGates = extractReadmeGateNumbers(readmeContent, /\| Gate (\d+) \|/g);

  if (scriptGates.size > 0 && readmeGates.size > 0) {
    const numericSort = (a, b) => +a - +b;
    const { scriptOnly, readmeOnly } = compareGateSets(scriptGates, readmeGates, 'Pre-commit', numericSort);
    if (scriptOnly.length > 0 || readmeOnly.length > 0) {
      return false;
    }
    console.error(`[drift-check] OK: pre-commit ${scriptGates.size} gates match README`);
  }
  return true;
}

function checkPrePushDrift(prePushPath, readmePath) {
  let scriptContent = '';
  if (fs.existsSync(prePushPath)) {
    scriptContent = fs.readFileSync(prePushPath, 'utf8');
  } else {
    console.error('[drift-check] WARN: githooks/pre-push not found, skipping pre-push check');
    return null;
  }

  const scriptGates = extractReadmeGateNumbers(scriptContent, /[Gg][Aa][Tt][Ee] (M\d*)/g);

  let readmeContent = '';
  if (fs.existsSync(readmePath)) {
    readmeContent = fs.readFileSync(readmePath, 'utf8');
  } else {
    return true;
  }

  const readmeGates = extractReadmeGateNumbers(readmeContent, /\| Gate (M\d*) \|/g);

  if (scriptGates.size > 0 && readmeGates.size > 0) {
    const { scriptOnly, readmeOnly } = compareGateSets(scriptGates, readmeGates, 'Pre-push');
    if (scriptOnly.length > 0 || readmeOnly.length > 0) {
      return false;
    }
    console.error(`[drift-check] OK: pre-push ${scriptGates.size} gates match README`);
  }
  return true;
}

/**
 * Docs-drift check (REQ-TDD-005): compare Gate table in README.md against
 * actual gate definitions in githooks/pre-commit and githooks/pre-push.
 * Blocks publish if counts diverge.
 */
/**
 * Adapter mirror drift check (REQ-329): compares githooks/adapters/ (source of truth)
 * against src/npm-package/adapters/ (npm mirror). Content must be byte-identical;
 * any mismatch blocks publish because syncAdapters() would overwrite the mirror.
 */
function checkAdapterDrift(srcRootPath, mirrorRootPath) {
  const srcRoot = srcRootPath || path.join(REPO_ROOT, 'githooks', 'adapters');
  const mirrorRoot = mirrorRootPath || path.join(PKG_ROOT, 'adapters');

  if (!fs.existsSync(srcRoot)) {
    console.error('[drift-check] WARN: githooks/adapters not found, skipping adapter drift check');
    return true;
  }
  if (!fs.existsSync(mirrorRoot)) {
    console.error('[drift-check] WARN: src/npm-package/adapters not found, skipping adapter drift check');
    return true;
  }

  const crypto = require('crypto');

  /**
   * Recursively compute a sorted, deterministic hash table for a directory.
   * Keys are relative paths (POSIX separators); values are SHA-256 hex digests.
   */
  function hashDirectory(root) {
    const table = {};
    function walk(dir, base) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // Sort for determinism
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.posix.join(base, entry.name);
        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.isFile()) {
          if (shouldSkipFile(entry.name)) continue;
          const buf = fs.readFileSync(full);
          table[rel] = crypto.createHash('sha256').update(buf).digest('hex');
        }
      }
    }
    walk(root, '');
    return table;
  }

  const srcHashes = hashDirectory(srcRoot);
  const mirrorHashes = hashDirectory(mirrorRoot);

  // Check for files only in one side
  const srcOnly = Object.keys(srcHashes).filter((f) => !(f in mirrorHashes));
  const mirrorOnly = Object.keys(mirrorHashes).filter((f) => !(f in srcHashes));

  // Check for content mismatches
  const mismatched = [];
  for (const f of Object.keys(srcHashes)) {
    if (mirrorHashes[f] && srcHashes[f] !== mirrorHashes[f]) {
      mismatched.push(f);
    }
  }

  if (srcOnly.length > 0) {
    console.error(`[drift-check] ERROR: ${srcOnly.length} file(s) in githooks/adapters/ missing from npm-package mirror:`);
    for (const f of srcOnly) console.error(`  - ${f}`);
  }
  if (mirrorOnly.length > 0) {
    console.error(`[drift-check] ERROR: ${mirrorOnly.length} file(s) in npm-package mirror NOT in githooks/adapters/:`);
    for (const f of mirrorOnly) console.error(`  - ${f}`);
  }
  if (mismatched.length > 0) {
    console.error(`[drift-check] ERROR: ${mismatched.length} adapter file(s) have drifted (SHA-256 mismatch):`);
    for (const f of mismatched) console.error(`  - ${f}`);
    console.error('[drift-check] Fix: Run `node src/npm-package/scripts/sync-package-content.js` (or `npm pack`) to resync.');
  }

  if (srcOnly.length > 0 || mirrorOnly.length > 0 || mismatched.length > 0) {
    return false;
  }

  const totalSrc = Object.keys(srcHashes).length;
  const totalMirror = Object.keys(mirrorHashes).length;
  console.error(`[drift-check] OK: ${totalSrc} adapter files match between githooks/adapters/ and npm-package mirror (${totalMirror} files)`);
  return true;
}

function checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath) {
  const preCommitScript = preCommitPath || path.join(REPO_ROOT, 'githooks', 'pre-commit');
  const prePushScript = prePushPath || path.join(REPO_ROOT, 'githooks', 'pre-push');
  const readme = readmePath || path.join(REPO_ROOT, 'README.md');

  const preCommitResult = checkPreCommitDrift(preCommitScript, readme);
  if (preCommitResult === false) return false;

  const prePushResult = checkPrePushDrift(prePushScript, readme);
  if (prePushResult === false) return false;

  return true;
}

function main() {
  console.error(`[sync] repo root: ${REPO_ROOT}`);
  console.error(`[sync] package root: ${PKG_ROOT}`);
  if (checkDocsDrift() === false) {
    process.exit(1);
  }
  if (checkAdapterDrift() === false) {
    process.exit(1);
  }
  const skills = syncSkills();
  const plugins = syncPlugins();
  const scripts = syncScripts();
  const adapters = syncAdapters();
  const hooks = syncHooks();
  const principles = syncModules('principles');
  const mutation = syncModules('mutation');
  const mockPolicy = syncModules('mock-policy');
  const buildIntegrity = syncModules('build-integrity');
  console.error(`[sync] done: ${skills} skill(s), ${plugins} plugin(s), ${scripts} script(s), ${adapters} adapter entries, ${hooks} hook entries, ${principles + mutation + mockPolicy + buildIntegrity} module(s)`);
  if (skills !== CORE_SKILLS.length) {
    console.error(`[sync] ERROR: expected ${CORE_SKILLS.length} skills, copied ${skills}`);
    process.exit(1);
  }
  if (plugins !== PLUGINS.length) {
    console.error(`[sync] ERROR: expected ${PLUGINS.length} plugins, copied ${plugins}`);
    process.exit(1);
  }

  // tui-plugin removed in v0.13.0 — validation skipped.
}

if (require.main !== module) {
  module.exports = { checkDocsDrift, checkAdapterDrift };
}

main();
