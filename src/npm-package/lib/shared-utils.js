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
  ['pre-commit', 'pre-push'].forEach(hook => {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(destDir, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  });
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
  const githooksDir = path.resolve(srcDir, '..', '..', '..', 'githooks');
  if (fs.existsSync(githooksDir)) {
    fs.readdirSync(githooksDir).forEach(f => {
      if (f.startsWith('gate-') && f.endsWith('.sh')) {
        fs.copyFileSync(path.join(githooksDir, f), path.join(destDir, f));
      }
    });
  }
}

module.exports = { copyDirRecursive, readXpGateConfig, copyHooks, copyAdapters };
