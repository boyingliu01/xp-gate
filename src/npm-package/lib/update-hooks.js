/**
 * @test REQ-265 update-hooks command
 * @intent Sync latest hook versions from xp-gate package to project or global directory
 * @covers AC-265-01, AC-265-02, AC-265-03, AC-265-04
 */
const fs = require('fs');
const path = require('path');
const { GLOBAL_HOOKS_DIR, GLOBAL_ADAPTERS_DIR } = require('./shared-paths.js');

/**
 * Get the xp-gate package root directory (src/npm-package/).
 * @returns {string}
 */
function getPackageRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Get the project's git hooks directory.
 * @throws {Error} If not in a git repository
 * @returns {string}
 */
function getProjectHooksDir() {
  const gitDir = path.join(process.cwd(), '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Not a Git repository: .git directory not found');
  }
  return path.join(gitDir, 'hooks');
}

/**
 * Detect locally modified hook files by comparing source and destination contents.
 * @param {string} srcDir - Package root directory
 * @param {string} hooksDestDir - Destination hooks directory
 * @param {string} adaptersDestDir - Destination adapters directory
 * @returns {string[]} List of locally modified file names
 */
function detectLocalModifications(srcDir, hooksDestDir, adaptersDestDir) {
  const modified = [];

  // Check hook files: pre-commit, pre-push
  ['pre-commit', 'pre-push'].forEach(hook => {
    const srcPath = path.join(srcDir, 'hooks', hook);
    const destPath = path.join(hooksDestDir, hook);
    if (fs.existsSync(destPath) && fs.existsSync(srcPath)) {
      const srcContent = fs.readFileSync(srcPath, 'utf8');
      const destContent = fs.readFileSync(destPath, 'utf8');
      if (srcContent !== destContent) {
        modified.push(hook);
      }
    }
  });

  // Check adapter-common.sh
  const adapterCommonSrc = path.join(srcDir, 'adapter-common.sh');
  const adapterCommonDest = path.join(adaptersDestDir, 'adapter-common.sh');
  if (fs.existsSync(adapterCommonDest) && fs.existsSync(adapterCommonSrc)) {
    const srcContent = fs.readFileSync(adapterCommonSrc, 'utf8');
    const destContent = fs.readFileSync(adapterCommonDest, 'utf8');
    if (srcContent !== destContent) {
      modified.push('adapter-common.sh');
    }
  }

  // Check adapters/*.sh
  const srcAdaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(srcAdaptersDir)) {
    fs.readdirSync(srcAdaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        const srcPath = path.join(srcAdaptersDir, f);
        const destPath = path.join(adaptersDestDir, 'adapters', f);
        if (fs.existsSync(destPath) && fs.existsSync(srcPath)) {
          const srcContent = fs.readFileSync(srcPath, 'utf8');
          const destContent = fs.readFileSync(destPath, 'utf8');
          if (srcContent !== destContent) {
            modified.push(`adapters/${f}`);
          }
        }
      }
    });
  }

  // Check gate-*.sh scripts
  if (fs.existsSync(srcDir)) {
    fs.readdirSync(srcDir).forEach(f => {
      if (f.startsWith('gate-') && f.endsWith('.sh')) {
        const srcPath = path.join(srcDir, f);
        const destPath = path.join(adaptersDestDir, f);
        if (fs.existsSync(destPath) && fs.existsSync(srcPath)) {
          const srcContent = fs.readFileSync(srcPath, 'utf8');
          const destContent = fs.readFileSync(destPath, 'utf8');
          if (srcContent !== destContent) {
            modified.push(f);
          }
        }
      }
    });
  }

  return modified;
}

/**
 * Atomically copy a file: write to .tmp then rename. Create .bak backup if enabled.
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {boolean} dryRun - If true, only log what would happen
 * @param {boolean} noBackup - If true, skip backup creation
 * @param {string} label - Human-readable label for logging
 * @returns {boolean} Whether the file was copied
 */
function atomicCopyFile(src, dest, dryRun, noBackup, label) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ ${label} not found, skipping`);
    return false;
  }

  if (dryRun) {
    console.log(`  would update: ${label}`);
    return true;
  }

  // Ensure destination directory exists
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });

  // Create backup if enabled
  if (!noBackup && fs.existsSync(dest)) {
    fs.copyFileSync(dest, `${dest}.bak`);
  }

  // Atomic write: temp file + rename
  const tmpDest = `${dest}.tmp`;
  fs.copyFileSync(src, tmpDest);
  fs.renameSync(tmpDest, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`  ✓ ${label}`);
  return true;
}

/**
 * Copy hook files (pre-commit, pre-push) from package to destination.
 * @param {string} srcDir - Package root directory
 * @param {string} destDir - Destination hooks directory
 * @param {boolean} dryRun
 * @param {boolean} noBackup
 */
function copyHooks(srcDir, destDir, dryRun, noBackup) {
  const hooksSrcDir = path.join(srcDir, 'hooks');
  ['pre-commit', 'pre-push'].forEach(hook => {
    const src = path.join(hooksSrcDir, hook);
    const dest = path.join(destDir, hook);
    atomicCopyFile(src, dest, dryRun, noBackup, hook);
  });
}

/**
 * Copy adapter files (adapter-common.sh + adapters/*.sh) from package to destination.
 * @param {string} srcDir - Package root directory
 * @param {string} destDir - Destination directory (githooks/ for local, adapters/ for global)
 * @param {boolean} dryRun
 * @param {boolean} noBackup
 */
function copyAdapters(srcDir, destDir, dryRun, noBackup) {
  // Copy adapter-common.sh from package root
  const adapterCommonSrc = path.join(srcDir, 'adapter-common.sh');
  const adapterCommonDest = path.join(destDir, 'adapter-common.sh');
  atomicCopyFile(adapterCommonSrc, adapterCommonDest, dryRun, noBackup, 'adapter-common.sh');

  // Copy adapters/*.sh
  const srcAdaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(srcAdaptersDir)) {
    fs.readdirSync(srcAdaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        const src = path.join(srcAdaptersDir, f);
        const dest = path.join(destDir, 'adapters', f);
        atomicCopyFile(src, dest, dryRun, noBackup, `adapters/${f}`);
      }
    });
  }
}

/**
 * Copy gate-*.sh scripts from package root to destination.
 * @param {string} srcDir - Package root directory
 * @param {string} destDir - Destination directory
 * @param {boolean} dryRun
 * @param {boolean} noBackup
 */
function copyGateScripts(srcDir, destDir, dryRun, noBackup) {
  if (!fs.existsSync(srcDir)) return;
  fs.readdirSync(srcDir).forEach(f => {
    if (f.startsWith('gate-') && f.endsWith('.sh')) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      atomicCopyFile(src, dest, dryRun, noBackup, f);
    }
  });
}

function resolveSrcDir() {
  return (module.exports && module.exports.getPackageRoot)
    ? module.exports.getPackageRoot()
    : getPackageRoot();
}

function resolveDirs(global) {
  if (global) return { hooksDestDir: GLOBAL_HOOKS_DIR, adaptersDestDir: GLOBAL_ADAPTERS_DIR };
  return { hooksDestDir: getProjectHooksDir(), adaptersDestDir: path.join(process.cwd(), 'githooks') };
}

function ensureDirsExist(adaptersDestDir, hooksDestDir) {
  fs.mkdirSync(hooksDestDir, { recursive: true });
  fs.mkdirSync(adaptersDestDir, { recursive: true });
  fs.mkdirSync(path.join(adaptersDestDir, 'adapters'), { recursive: true });
}

function printUpdateHeader(opts) {
  const { global, srcDir, hooksDestDir, adaptersDestDir, scope, dryRun } = opts;
  console.log(`XP-Gate Update Hooks`);
  console.log(`====================`);
  console.log(`Mode: ${global ? 'Global' : 'Local'}`);
  console.log(`Source: ${srcDir}`);
  console.log(`Hooks destination: ${hooksDestDir}`);
  console.log(`Adapters destination: ${adaptersDestDir}`);
  console.log(`Scope: ${scope}`);
  if (dryRun) console.log(`Dry run: yes (no files will be modified)`);
  console.log('');
}

function checkLocalModifications(srcDir, hooksDestDir, adaptersDestDir, force, dryRun) {
  if (force || dryRun) return 0;
  const localMods = detectLocalModifications(srcDir, hooksDestDir, adaptersDestDir);
  if (localMods.length === 0) return 0;
  console.warn(`[WARN] Detected ${localMods.length} locally modified file(s):`);
  localMods.forEach(f => console.warn(`  - ${f}`));
  console.warn('Use --force to overwrite, or manually backup first.');
  return 1;
}

function copyByScope(opts) {
  const { scope, srcDir, hooksDestDir, adaptersDestDir, dryRun, noBackup } = opts;
  if (scope === 'all' || scope === 'hooks') {
    printInfo('hooks');
    copyHooks(srcDir, hooksDestDir, dryRun, noBackup);
  }
  if (scope === 'all' || scope === 'adapters') {
    printInfo('adapters');
    copyAdapters(srcDir, adaptersDestDir, dryRun, noBackup);
  }
  if (scope === 'all') {
    printInfo('gate scripts');
    copyGateScripts(srcDir, adaptersDestDir, dryRun, noBackup);
  }
}

function printInfo(label) { console.log(`Updating ${label}...`); }

/**
 * Main entry point: sync latest hook versions from xp-gate package to project or global directory.
 */
function updateHooks(options = {}) {
  const { global = false, force = false, dryRun = false, noBackup = false, scope = 'all' } = options;
  const srcDir = resolveSrcDir();
  const { hooksDestDir, adaptersDestDir } = resolveDirs(global);

  ensureDirsExist(adaptersDestDir, hooksDestDir);
  printUpdateHeader({ global, srcDir, hooksDestDir, adaptersDestDir, scope, dryRun });

  const modCheck = checkLocalModifications(srcDir, hooksDestDir, adaptersDestDir, force, dryRun);
  if (modCheck !== 0) return modCheck;

  copyByScope({ scope, srcDir, hooksDestDir, adaptersDestDir, dryRun, noBackup });

  if (!dryRun) console.log('\nUpdate complete!');
  return 0;
}

module.exports = {
  updateHooks,
  detectLocalModifications,
  copyHooks,
  copyAdapters,
  copyGateScripts,
  atomicCopyFile,
  getPackageRoot,
  getProjectHooksDir,
};
