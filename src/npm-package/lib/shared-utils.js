/**
 * Pure utility functions shared by CLI modules.
 * No module-level state — safe for tests that mock fs/path/os.
 */
const fs = require('fs');
const path = require('path');

/**
 * Recursively copy a directory.
 * Pure function: only uses fs/path params, no global config.
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readXpGateConfig() {
  const cfgPath = path.join(require('os').homedir(), '.xp-gate', 'config.json');
  try {
    if (!fs.existsSync(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return null;
  }
}

function copyHooks(srcDir, destDir) {
  ['pre-commit', 'pre-push', 'post-merge'].forEach(hook => {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(destDir, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  });

  // Copy lib/ directory (e.g. now-ms.sh) — sourced by pre-commit at runtime
  const libSrc = path.join(srcDir, 'hooks', 'lib');
  const libDest = path.join(destDir, 'lib');
  if (fs.existsSync(libSrc)) {
    copyDirRecursive(libSrc, libDest);
  }
}

function copyAdapters(srcDir, destDir) {
  const adaptersDir = path.join(srcDir, 'adapters');
  const adapterCommon = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterCommon)) {
    fs.copyFileSync(adapterCommon, path.join(destDir, 'adapter-common.sh'));
  }
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        fs.copyFileSync(path.join(adaptersDir, f), path.join(destDir, f));
      }
    });
  }
  const githooksDir = path.resolve(srcDir, '..', '..', 'githooks');
  if (fs.existsSync(githooksDir)) {
    fs.readdirSync(githooksDir).forEach(f => {
      if ((f.startsWith('gate-') || f === 'sprint-gate.sh') && f.endsWith('.sh')) {
        fs.copyFileSync(path.join(githooksDir, f), path.join(destDir, f));
      }
    });
  }
  // Gate scripts ship at the package root — sync-package-content.js copies them
  // from githooks/ during prepack. Installed environments have no repo-level
  // githooks/, so the package root is the only reliable source.
  if (fs.existsSync(srcDir)) {
    fs.readdirSync(srcDir).forEach(f => {
      if ((f.startsWith('gate-') || f === 'sprint-gate.sh') && f.endsWith('.sh')) {
        fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
      }
    });
  }
}

/**
 * The flags the skill commands implement. A flag outside this list used to be
 * dropped silently, so `xp-gate install-skill <name> --offline` — the form the
 * CLI documented until the bundle-only installer (#416) removed it — exited 0
 * having done nothing with the flag. Same defect class as the one #488 fixed for
 * `doctor --sync-hooks`: an ignored option must be answered loudly.
 */
const SKILL_FLAGS = ['--verbose', '--force', '--all', '--check'];

/**
 * @param {string[]} args - arguments after the skill name
 * @returns {{options: Object.<string, boolean>, unknown: string[]}}
 */
function parseSkillFlags(args) {
  const options = { verbose: false, force: false, all: false, check: false };
  const unknown = [];
  for (const arg of args) {
    if (!SKILL_FLAGS.includes(arg)) {
      unknown.push(arg);
      continue;
    }
    options[arg.slice(2)] = true;
  }
  return { options, unknown };
}

module.exports = { copyDirRecursive, readXpGateConfig, copyHooks, copyAdapters, SKILL_FLAGS, parseSkillFlags };
