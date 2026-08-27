/**
 * @test REQ-265 update-hooks command
 * @intent Sync latest hook versions from xp-gate package to project or global directory
 * @covers AC-265-01, AC-265-02, AC-265-03, AC-265-04
 */
const fs = require('node:fs');
const path = require('node:path');
const { GLOBAL_HOOKS_DIR, GLOBAL_ADAPTERS_DIR, GLOBAL_MODULES_DIR, CONFIG_DIR } = require('./shared-paths.js');

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

  // Check sprint-gate.sh in the hooks directory (Gate MS resolves it there)
  const sprintGateSrc = path.join(srcDir, 'sprint-gate.sh');
  const sprintGateDest = path.join(hooksDestDir, 'sprint-gate.sh');
  if (fs.existsSync(sprintGateDest) && fs.existsSync(sprintGateSrc)) {
    const srcContent = fs.readFileSync(sprintGateSrc, 'utf8');
    const destContent = fs.readFileSync(sprintGateDest, 'utf8');
    if (srcContent !== destContent) {
      modified.push('sprint-gate.sh');
    }
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
  const libSrcDir = path.join(hooksSrcDir, 'lib');
  if (fs.existsSync(libSrcDir)) {
    fs.readdirSync(libSrcDir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .forEach(entry => {
        const label = `lib/${entry.name}`;
        atomicCopyFile(
          path.join(libSrcDir, entry.name),
          path.join(destDir, label),
          dryRun,
          noBackup,
          label
        );
      });
  }
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

/**
 * Copy sprint-gate.sh from package root to the hooks directory.
 * The pre-push Gate MS resolves it at $(dirname "$0")/sprint-gate.sh, i.e.
 * alongside pre-commit/pre-push — NOT the adapters directory.
 * @param {string} srcDir - Package root directory
 * @param {string} hooksDestDir - Destination hooks directory
 * @param {boolean} dryRun
 * @param {boolean} noBackup
 */
function copySprintGate(srcDir, hooksDestDir, dryRun, noBackup) {
  const src = path.join(srcDir, 'sprint-gate.sh');
  if (!fs.existsSync(src)) return;
  atomicCopyFile(src, path.join(hooksDestDir, 'sprint-gate.sh'), dryRun, noBackup, 'sprint-gate.sh');
}

/**
 * Copy quality gate modules (principles, mutation, mock-policy, build-integrity)
 * into the modules directory. These ship in the npm package but were never
 * installed by an already-initialized global setup, so update-hooks must
 * re-deploy them to repair Gate 9/10 (build-integrity) on existing installs.
 * @param {string} srcDir - Package root directory
 * @param {string} modulesDestDir - Destination modules directory
 * @param {boolean} dryRun
 * @param {boolean} noBackup
 */
const MODULES = ['principles', 'mutation', 'mock-policy', 'build-integrity'];
function copyModules(srcDir, modulesDestDir, dryRun, noBackup) {
  MODULES.forEach(module => {
    const srcDirPath = path.join(srcDir, module);
    if (!fs.existsSync(srcDirPath)) return;
    const destDirPath = path.join(modulesDestDir, module);
    fs.mkdirSync(destDirPath, { recursive: true });
    fs.readdirSync(srcDirPath).forEach(entry => {
      const srcEntry = path.join(srcDirPath, entry);
      const destEntry = path.join(destDirPath, entry);
      const stats = fs.statSync(srcEntry);
      if (stats.isDirectory()) {
        copyRecursiveDir(srcEntry, destEntry, dryRun, noBackup, module);
      } else if (!dryRun) {
        atomicCopyFile(srcEntry, destEntry, dryRun, noBackup, `${module}/${entry}`);
      }
    });
    if (!dryRun) console.log(`  ${module}/ -> ${modulesDestDir}/${module}/`);
  });
}

function copyRecursiveDir(src, dest, dryRun, noBackup, label) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(entry => {
    const srcEntry = path.join(src, entry);
    const destEntry = path.join(dest, entry);
    if (fs.statSync(srcEntry).isDirectory()) {
      copyRecursiveDir(srcEntry, destEntry, dryRun, noBackup, label);
    } else {
      atomicCopyFile(srcEntry, destEntry, dryRun, noBackup, `${label}/${entry}`);
    }
  });
}

function resolveSrcDir() {
  return module.exports?.getPackageRoot
    ? module.exports.getPackageRoot()
    : getPackageRoot();
}

function resolveDirs(global) {
  if (global) return { hooksDestDir: GLOBAL_HOOKS_DIR, adaptersDestDir: GLOBAL_ADAPTERS_DIR, modulesDestDir: GLOBAL_MODULES_DIR };
  return { hooksDestDir: getProjectHooksDir(), adaptersDestDir: path.join(process.cwd(), 'githooks'), modulesDestDir: path.join(process.cwd(), '.xp-gate', 'modules') };
}

function ensureDirsExist(adaptersDestDir, hooksDestDir, modulesDestDir) {
  fs.mkdirSync(hooksDestDir, { recursive: true });
  fs.mkdirSync(adaptersDestDir, { recursive: true });
  fs.mkdirSync(path.join(adaptersDestDir, 'adapters'), { recursive: true });
  if (modulesDestDir) fs.mkdirSync(modulesDestDir, { recursive: true });
}

function printUpdateHeader(opts) {
  const { global, srcDir, hooksDestDir, adaptersDestDir, modulesDestDir, scope, dryRun } = opts;
  console.log(`XP-Gate Update Hooks`);
  console.log(`====================`);
  console.log(`Mode: ${global ? 'Global' : 'Local'}`);
  console.log(`Source: ${srcDir}`);
  console.log(`Hooks destination: ${hooksDestDir}`);
  console.log(`Adapters destination: ${adaptersDestDir}`);
  if (modulesDestDir) console.log(`Modules destination: ${modulesDestDir}`);
  console.log(`Scope: ${scope}`);
  if (dryRun) console.log(`Dry run: yes (no files will be modified)`);
  console.log('');
}

function checkLocalModifications(srcDir, hooksDestDir, adaptersDestDir, force, dryRun) {
  if (force || dryRun) return 0;
  const localMods = detectLocalModifications(srcDir, hooksDestDir, adaptersDestDir);
  if (localMods.length === 0) return 0;
  console.warn(`[WARN] Detected ${localMods.length} locally modified file(s):`);
  localMods.forEach(f => {
    console.warn(`  - ${f}`);
  });
  console.warn('Use --force to overwrite, or manually backup first.');
  return 1;
}

function copyByScope(opts) {
  const { scope, srcDir, hooksDestDir, adaptersDestDir, modulesDestDir, dryRun, noBackup } = opts;
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
    if (modulesDestDir) {
      printInfo('modules');
      copyModules(srcDir, modulesDestDir, dryRun, noBackup);
    }
  }
  if (scope === 'all' || scope === 'hooks') {
    copySprintGate(srcDir, hooksDestDir, dryRun, noBackup);
  }
}

function warnMissingModuleDeps(global, dryRun) {
  if (!global || dryRun) return;
  // Copied gate modules (e.g. mock-policy) import js-yaml/zod installed into
  // <CONFIG_DIR>/node_modules by setup-global. If absent (e.g. an install made
  // before that step existed), Gate ML would crash at push — guide the user to
  // re-run setup-global rather than silently failing.
  const depsDir = path.join(CONFIG_DIR, 'node_modules', 'js-yaml');
  if (!fs.existsSync(depsDir)) {
    console.warn('\n[warn] Global quality-gate module runtime deps not found.');
    console.warn(`  Expected: ${path.join(CONFIG_DIR, 'node_modules')}`);
    console.warn('  Run `xp-gate setup-global` once to install them (Gate ML needs js-yaml/zod).');
  }
}

function printInfo(label) { console.log(`Updating ${label}...`); }

/**
 * Main entry point: sync latest hook versions from xp-gate package to project or global directory.
 */
function updateHooks(options = {}) {
  const { global = false, force = false, dryRun = false, noBackup = false, scope = 'all' } = options;
  const srcDir = resolveSrcDir();
  const { hooksDestDir, adaptersDestDir, modulesDestDir } = resolveDirs(global);

  ensureDirsExist(adaptersDestDir, hooksDestDir, modulesDestDir);
  printUpdateHeader({ global, srcDir, hooksDestDir, adaptersDestDir, modulesDestDir, scope, dryRun });

  const modCheck = checkLocalModifications(srcDir, hooksDestDir, adaptersDestDir, force, dryRun);
  if (modCheck !== 0) return modCheck;

  copyByScope({ scope, srcDir, hooksDestDir, adaptersDestDir, modulesDestDir, dryRun, noBackup });
  warnMissingModuleDeps(global, dryRun);

  if (!dryRun) console.log('\nUpdate complete!');
  return 0;
}

module.exports = {
  updateHooks,
  detectLocalModifications,
  copyHooks,
  copyAdapters,
  copyGateScripts,
  copySprintGate,
  copyModules,
  warnMissingModuleDeps,
  atomicCopyFile,
  getPackageRoot,
  getProjectHooksDir,
};
