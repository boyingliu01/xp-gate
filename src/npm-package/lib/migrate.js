const fs = require('fs');
const path = require('path');
const os = require('os');

// Cross-platform home directory resolution (matches other modules pattern)
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

/**
 * Migration helper for v0.4.x → v0.5.x.
 * - Cleans GitHub Packages PAT lines from ~/.npmrc
 * - Checks ~/.config/xp-gate/cache/ for old cached downloads
 *
 * Safety: Only removes lines that contain 'npm.pkg.github.com'.
 * Generic PAT lines (other registries) are never touched.
 *
 * @param {string[]} args - CLI arguments (--dry-run supported)
 * @returns {Promise<number>} exit code (0 = success)
 */
function cleanNpmrc({ npmrcPath, dryRun }) {
  if (!fs.existsSync(npmrcPath)) {
    console.log('  No ~/.npmrc found — nothing to clean.');
    return { changed: false, removedCount: 0 };
  }

  const content = fs.readFileSync(npmrcPath, 'utf8');
  const lines = content.split('\n');
  const linesToRemove = [];
  const keptLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('npm.pkg.github.com')) {
      linesToRemove.push(line);
    } else {
      keptLines.push(line);
    }
  }

  if (linesToRemove.length === 0) {
    console.log('  No GitHub Packages lines found — ~/.npmrc is clean.');
    return { changed: false, removedCount: 0 };
  }

  console.log(`  Found ${linesToRemove.length} npm.pkg.github.com line(s):`);
  for (const line of linesToRemove) {
    const masked = line.replace(/(:_authToken=).+/, '$1***');
    console.log(`    - ${masked}`);
  }

  if (dryRun) {
    console.log('');
    console.log('  [Dry-run] No changes made. Would remove the above line(s).');
    return { changed: false, removedCount: linesToRemove.length };
  }

  const newContent = keptLines.join('\n');
  fs.writeFileSync(npmrcPath, newContent, 'utf8');
  console.log('  Cleaned successfully.');
  return { changed: true, removedCount: linesToRemove.length };
}

function checkCacheDir({ cacheDir, dryRun }) {
  if (!fs.existsSync(cacheDir)) {
    console.log('  No old cache directory found.');
    return;
  }

  const items = fs.readdirSync(cacheDir);
  if (items.length === 0) {
    console.log('  Cache directory exists but is empty.');
    return;
  }

  console.log(`  Found ${items.length} cached file(s) from old installation.`);
  for (const item of items) {
    const itemPath = path.join(cacheDir, item);
    const stat = fs.statSync(itemPath);
    const size = stat.isFile() ? `(${formatSize(stat.size)})` : '(directory)';
    console.log(`    - ${item} ${size}`);
  }

  if (!dryRun) {
    console.log('  Note: These files are harmless but no longer needed.');
    console.log('  You can safely remove them with: rm -rf ' + cacheDir);
  }
}

function printSummary(removedCount, cacheDir, wasDryRun) {
  const hasCacheItems = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0;
  const removedLabel = removedCount > 0 ? `${removedCount} GitHub Packages line(s) ${wasDryRun ? 'would be ' : ''}removed` : 'No changes needed';
  console.log('');
  console.log('Migration Summary:');
  console.log(`  ~/.npmrc: ${removedLabel}`);
  console.log(`  Cache:    ${hasCacheItems ? 'Old files found (can be cleaned manually)' : 'No old cache found'}`);
  console.log('');
  console.log('Migration complete. xp-gate v0.5.x no longer requires GitHub Packages or PAT tokens.');
}

async function migrate(args = []) {
  const options = { dryRun: args.includes('--dry-run') };
  const npmrcPath = path.join(HOME, '.npmrc');
  const cacheDir = path.join(HOME, '.config', 'xp-gate', 'cache');

  console.log('Checking ~/.npmrc for GitHub Packages residue...');
  const { removedCount } = cleanNpmrc({ npmrcPath, dryRun: options.dryRun });

  console.log('');
  console.log('Checking ~/.config/xp-gate/cache/ for old downloads...');
  checkCacheDir({ cacheDir, dryRun: options.dryRun });

  printSummary(removedCount, cacheDir, options.dryRun);
  return 0;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { migrate };
