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
async function migrate(args = []) {
  const options = { dryRun: args.includes('--dry-run') };

  const npmrcPath = path.join(HOME, '.npmrc');
  const cacheDir = path.join(HOME, '.config', 'xp-gate', 'cache');

  let npmrcChanged = false;
  let npmrcRemovedCount = 0;

  // === Phase 1: ~/.npmrc cleanup ===
  console.log('Checking ~/.npmrc for GitHub Packages residue...');

  if (!fs.existsSync(npmrcPath)) {
    console.log('  No ~/.npmrc found — nothing to clean.');
  } else {
    const content = fs.readFileSync(npmrcPath, 'utf8');
    const lines = content.split('\n');

    // Find lines that reference npm.pkg.github.com
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

    npmrcRemovedCount = linesToRemove.length;

    if (npmrcRemovedCount === 0) {
      console.log('  No GitHub Packages lines found — ~/.npmrc is clean.');
    } else {
      console.log(`  Found ${npmrcRemovedCount} npm.pkg.github.com line(s):`);

      for (const line of linesToRemove) {
        // Mask auth tokens in output for safety
        const masked = line.replace(/(:_authToken=).+/, '$1***');
        console.log(`    - ${masked}`);
      }

      if (options.dryRun) {
        console.log('');
        console.log('  [Dry-run] No changes made. Would remove the above line(s).');
      } else {
        // Write back without GitHub Packages lines
        const newContent = keptLines.join('\n');
        fs.writeFileSync(npmrcPath, newContent, 'utf8');
        console.log('  Cleaned successfully.');
        npmrcChanged = true;
      }
    }
  }

  // === Phase 2: Cache check ===
  console.log('');
  console.log('Checking ~/.config/xp-gate/cache/ for old downloads...');

  if (!fs.existsSync(cacheDir)) {
    console.log('  No old cache directory found.');
  } else {
    const items = fs.readdirSync(cacheDir);

    if (items.length === 0) {
      console.log('  Cache directory exists but is empty.');
    } else {
      console.log(`  Found ${items.length} cached file(s) from old installation.`);
      for (const item of items) {
        const itemPath = path.join(cacheDir, item);
        const stat = fs.statSync(itemPath);
        const size = stat.isFile() ? `(${formatSize(stat.size)})` : '(directory)';
        console.log(`    - ${item} ${size}`);
      }

      if (!options.dryRun) {
        console.log('  Note: These files are harmless but no longer needed.');
        console.log('  You can safely remove them with: rm -rf ' + cacheDir);
      }
    }
  }

  // === Phase 3: Summary ===
  console.log('');
  console.log('Migration Summary:');
  console.log(`  ~/.npmrc: ${npmrcRemovedCount > 0 ? `${npmrcRemovedCount} GitHub Packages line(s) ${options.dryRun ? 'would be' : ''}removed` : 'No changes needed'}`);
  console.log(`  Cache:    ${fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0 ? 'Old files found (can be cleaned manually)' : 'No old cache found'}`);
  console.log('');
  console.log('Migration complete. xp-gate v0.5.x no longer requires GitHub Packages or PAT tokens.');

  return 0;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { migrate };
