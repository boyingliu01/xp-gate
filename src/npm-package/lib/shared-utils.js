/**
 * Pure utility functions shared by CLI modules.
 * No module-level state — safe for tests that mock fs/path/os.
 */
const fs = require('fs');

/**
 * Recursively copy a directory.
 * Pure function: only uses fs/path params, no global config.
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = require('path').join(src, entry.name);
    const destPath = require('path').join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { copyDirRecursive };
