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

module.exports = { copyDirRecursive, readXpGateConfig };
