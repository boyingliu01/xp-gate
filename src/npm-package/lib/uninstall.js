const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  TEMPLATE_DIR,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
  GLOBAL_MODULES_DIR,
} = require('./shared-paths.js');

const BACKUP_DIR = path.join(CONFIG_DIR, '.uninstall-backup');

/**
 * Skill directory roots the CLI installs into, per platform (mirror of the
 * installers in install-skill.js). Read at call time so a test can point HOME at a
 * throwaway tree.
 */
function globalSkillRoots() {
  return [
    path.join(HOME_DIR(), '.qoder', 'skills'),
    path.join(HOME_DIR(), '.config', 'opencode', 'skills'),
    path.join(HOME_DIR(), '.claude', 'skills'),
  ];
}

/**
 * Directories inside ~/.config/xp-gate/ that `setup-global` creates and that
 * `uninstall` used to leave behind (#663).
 */
const GLOBAL_INSTALL_RESIDUE = [
  { key: 'modules', label: 'modules/' },
  { key: 'node_modules', label: 'node_modules/' },
  { key: 'package.json', label: 'package.json' },
  { key: 'package-lock.json', label: 'package-lock.json' },
  { key: 'xp-gate.json', label: 'xp-gate.json' },
];

/** User DATA that must survive an uninstall, and must be reported as retained. */
const GLOBAL_USER_DATA = [
  { key: '.delphi-config.json', label: '.delphi-config.json (your Delphi expert config)' },
];

/**
 * Signature strings used to verify file ownership.
 * Each hook/adapter file contains a unique marker string.
 */
const SIGNATURES = {
  'pre-commit': 'OpenCode Quality Gates - Pre-Commit Hook',
  'pre-push': 'Pre-push Hook - Code Walkthrough Result Validator',
  'post-merge': 'XP-Gate VERSION sync hook',
  'adapter-common.sh': 'detect_project_lang()'
};

function isXpGateFile(filePath, signature) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(signature);
  } catch {
    return false;
  }
}

/**
 * Verify file ownership using manifest sha256 first, then fall back to signature.
 * Returns true if the file belongs to xp-gate (by either method).
 */
function verifyFileOwnership(filePath, manifestEntry, signature) {
  if (!fs.existsSync(filePath)) return false;

  // Level 1: manifest sha256 check
  if (manifestEntry && manifestEntry.sha256) {
    try {
      const content = fs.readFileSync(filePath);
      const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (actualSha256 === manifestEntry.sha256) {
        return true; // Exact sha256 match
      }
      console.warn(`  Warning: sha256 mismatch for ${path.basename(filePath)}, falling back to signature check`);
    } catch (e) {
      // Fall through to signature check
    }
  }

  // Level 2: signature string fallback
  return isXpGateFile(filePath, signature);
}

function getConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getGitDir() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getCurrentHooksPath() {
  try {
    const { execSync } = require('child_process');
    const result = execSync('git config --global core.hooksPath', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch {
    return null;
  }
}

function unsetHooksPath() {
  try {
    const { execSync } = require('child_process');
    execSync('git config --global --unset core.hooksPath', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (e) {
    console.warn(`  Warning: Could not unset core.hooksPath: ${e.message}`);
    return false;
  }
}

/**
 * Create a backup snapshot of files/dirs before deletion.
 */
function createBackupSnapshot(plan) {
  // Use a unique backup dir for this uninstall session
  const sessionBackup = path.join(BACKUP_DIR, `uninstall-${Date.now()}`);
  fs.mkdirSync(sessionBackup, { recursive: true });

  const backupMeta = { sessionBackup, entries: [] };

  for (const item of plan) {
    if (!item.path || !fs.existsSync(item.path)) continue;

    const relPath = path.basename(item.path);
    const destPath = path.join(sessionBackup, relPath);

    try {
      const stat = fs.statSync(item.path);
      if (stat.isDirectory()) {
        copyDirSync(item.path, destPath);
      } else {
        fs.copyFileSync(item.path, destPath);
      }
      backupMeta.entries.push({ rel: relPath, original: item.path });
    } catch (e) {
      console.warn(`  Warning: Could not backup ${item.path}: ${e.message}`);
    }
  }

  return backupMeta;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanupBackup(backupMeta) {
  if (!backupMeta || !backupMeta.sessionBackup) return;
  try {
    fs.rmSync(backupMeta.sessionBackup, { recursive: true, force: true });
    // Remove parent backup dir if empty
    try {
      const parent = path.dirname(backupMeta.sessionBackup);
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
        fs.rmdirSync(parent);
      }
    } catch {
      // Ignore cleanup failures
    }
  } catch {
    // Ignore cleanup failures
  }
}

/**
 * Build the uninstall plan based on mode.
 * Returns an array of operation objects: { type, path, signature, label, critical }
 */
function buildPlan(mode) {
  const plan = [];
  const manifest = getConfig() && getConfig().manifest ? getConfig().manifest : null;

  if (mode === 'local') {
    const gitDir = getGitDir();
    if (gitDir) {
      const projectRoot = path.dirname(gitDir);
      const hooksDir = path.join(projectRoot, '.git', 'hooks');
      const githooksDir = path.join(projectRoot, 'githooks');

      plan.push({
        type: 'file',
        path: path.join(hooksDir, 'pre-commit'),
        signature: SIGNATURES['pre-commit'],
        label: '.git/hooks/pre-commit',
        manifestKey: '.git/hooks/pre-commit',
        critical: true
      });
      plan.push({
        type: 'file',
        path: path.join(hooksDir, 'pre-push'),
        signature: SIGNATURES['pre-push'],
        label: '.git/hooks/pre-push',
        manifestKey: '.git/hooks/pre-push',
        critical: true
      });
      plan.push({
        type: 'file',
        path: path.join(hooksDir, 'post-merge'),
        signature: SIGNATURES['post-merge'],
        label: '.git/hooks/post-merge',
        manifestKey: '.git/hooks/post-merge',
        critical: true
      });
      plan.push({
        type: 'file',
        path: path.join(githooksDir, 'adapter-common.sh'),
        signature: SIGNATURES['adapter-common.sh'],
        label: 'githooks/adapter-common.sh',
        manifestKey: 'githooks/adapter-common.sh',
        critical: true
      });
      const adaptersDir = path.join(githooksDir, 'adapters');
      if (fs.existsSync(adaptersDir)) {
        plan.push({
          type: 'dir',
          path: adaptersDir,
          label: 'githooks/adapters/',
          critical: true
        });
      }

      // Project-level config files (generated by init)
      const langConfig = path.join(projectRoot, '.xp-gate-config.json');
      if (fs.existsSync(langConfig)) {
        plan.push({
          type: 'file',
          path: langConfig,
          signature: '"languages"',
          label: '.xp-gate-config.json',
          critical: false
        });
      }
      const baselineFile = path.join(projectRoot, '.warnings-baseline.json');
      if (fs.existsSync(baselineFile)) {
        plan.push({
          type: 'file',
          path: baselineFile,
          signature: '"warnings"',
          label: '.warnings-baseline.json',
          critical: false
        });
      }
    }
  }

  if (mode === 'global') {
    plan.push({
      type: 'gitconfig',
      action: 'unset-hooks-path',
      expectedPath: GLOBAL_HOOKS_DIR,
      label: 'git config --global core.hooksPath',
      critical: true
    });
    if (fs.existsSync(GLOBAL_HOOKS_DIR)) {
      plan.push({
        type: 'dir',
        path: GLOBAL_HOOKS_DIR,
        label: '~/.config/xp-gate/hooks/',
        critical: true
      });
    }
    if (fs.existsSync(GLOBAL_ADAPTERS_DIR)) {
      plan.push({
        type: 'dir',
        path: GLOBAL_ADAPTERS_DIR,
        label: '~/.config/xp-gate/adapters/',
        critical: true
      });
    }

    // #663: `setup-global` also writes modules/, a node_modules/ tree, a
    // package.json + package-lock.json and the xp-gate.json manifest. None of them
    // were in the plan, so uninstall printed "Uninstall complete" over an
    // installation that was still ~1000 files on disk. The residue is not
    // cosmetic: a leftover node_modules/ makes the NEXT setup-global skip its own
    // install and reuse a stale dependency tree, and a leftover xp-gate.json
    // carries the previous version's manifest/lastInit into `doctor`, which then
    // reports it as the current installation.
    const configDir = CONFIG_DIR;
    for (const item of GLOBAL_INSTALL_RESIDUE) {
      const target = path.join(configDir, item.key);
      if (fs.existsSync(target)) {
        const isDir = fs.statSync(target).isDirectory();
        plan.push({
          type: isDir ? 'dir' : 'file',
          path: target,
          label: `~/.config/xp-gate/${item.label}`,
          critical: false
        });
      }
    }

    // User data is deliberately NOT deleted. Reporting it is the second half of
    // the fix: leaving it behind silently is how a user ends up with a stray
    // config they cannot attribute.
    for (const item of GLOBAL_USER_DATA) {
      const target = path.join(configDir, item.key);
      if (fs.existsSync(target)) {
        plan.push({
          type: 'retain',
          retain: true,
          path: target,
          label: item.label,
          critical: false
        });
      }
    }
  }

  // Template dir is common to both modes
  if (fs.existsSync(TEMPLATE_DIR)) {
    plan.push({
      type: 'dir',
      path: TEMPLATE_DIR,
      label: '~/.config/opencode/git-hooks-template/',
      critical: true
    });
  }

  return plan;
}

/**
 * Remove a single file item with ownership verification.
 * @returns {boolean} true on success, false on skip (not xp-gate owned)
 */
function removeFile(item, config) {
  const manifestEntry = config.manifest && config.manifest.files
    ? config.manifest.files[item.manifestKey]
    : null;

  if (!verifyFileOwnership(item.path, manifestEntry, item.signature)) {
    if (fs.existsSync(item.path)) {
      console.warn(`  Warning: ${item.label} does not contain xp-gate signature — skipping`);
    }
    return false;
  }

  fs.unlinkSync(item.path);
  console.log(`  Removed ${item.label}`);
  return true;
}

/**
 * Remove a directory item.
 * @returns {boolean} true if dir existed and was removed, false otherwise
 */
function removeDir(item) {
  if (!fs.existsSync(item.path)) return false;

  // #664: the global `core.hooksPath` is a SHARED directory -- `git lfs install`
  // writes its own hooks into it -- so a blind recursive delete of a hooks dir
  // removes another tool's working files. Classify first; when foreign content is
  // present, delete only xp-gate's own entries and say what was kept.
  //
  // Restricted to directories that ARE a hooks dir. The template dir and the
  // adapters dir are wholly xp-gate-owned (the template legitimately contains an
  // `adapters/` subdir, which would otherwise be read as foreign), so only a path
  // that looks like a hooks root gets the conservative treatment.
  const isHooksDir = /(^|[\/])hooks$/.test(item.path) || item.label.includes('hooks/');
  const removal = isHooksDir ? planHooksDirRemoval(item.path) : { action: 'remove-all' };
  if (removal.action === 'remove-owned-only') {
    for (const name of removal.owned) {
      fs.rmSync(path.join(item.path, name), { recursive: true, force: true });
    }
    try { fs.rmdirSync(item.path); } catch { /* non-empty: foreign files remain */ }
    const sources = removal.foreign.map((f) => (f.source ? `${f.name} (${f.source})` : f.name));
    console.log(`  Removed xp-gate hooks from ${item.label}`);
    console.log(`  ⚠️  Kept ${removal.foreign.length} file(s) that are not xp-gate's: ${sources.join(', ')}`);
    console.log('     The global core.hooksPath is a shared directory; other tools (e.g. git lfs) install here.');
    return true;
  }

  fs.rmSync(item.path, { recursive: true, force: true });
  console.log(`  Removed ${item.label}`);
  return true;
}

/**
 * Unset core.hooksPath if it matches the expected xp-gate path.
 * @returns {boolean} true if unset was performed or already unset, false on mismatch
 */
function unsetGitConfigIfMatch(item) {
  const currentPath = getCurrentHooksPath();
  if (currentPath === null || currentPath === '') {
    console.log(`  ${item.label} — not set`);
    return true;
  }
  // #656: git returns a forward-slash path ("C:/Users/.../hooks"), while
  // item.expectedPath is built with path.join (backslashes on Windows). A raw
  // === compares these as different and the unset is silently skipped, leaving
  // a dangling core.hooksPath. Normalize both sides to an absolute, real path.
  if (sameHooksPath(currentPath, item.expectedPath)) {
    unsetHooksPath();
    console.log(`  Unset ${item.label}`);
    return true;
  }
  console.warn(`  Warning: core.hooksPath (${currentPath}) does not match xp-gate path — skipping unset`);
  return false;
}

/**
 * True when two hook-directory paths refer to the same location (#656), tolerant
 * of forward/back slashes, trailing separators, and case differences on Windows.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameHooksPath(a, b) {
  const norm = (p) => {
    let r = path.resolve(p);
    try { r = fs.realpathSync.native(r); } catch { /* path need not exist */ }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/**
 * Execute a single plan item (file/dir/gitconfig).
 * @returns {boolean} true on success, false on skip/failure
 */
function executePlanItem(item, config) {
  if (item.type === 'file') return removeFile(item, config);
  if (item.type === 'dir') return removeDir(item);
  if (item.type === 'gitconfig' && item.action === 'unset-hooks-path') return unsetGitConfigIfMatch(item);
  return false;
}

/**
 * @param {string[]} args CLI arguments
 * @returns {number} exit code (0 = success, 1 = error)
 */
async function uninstall(args) {
  const options = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    forceLocal: args.includes('--local'),
    forceGlobal: args.includes('--global'),
    purge: args.includes('--purge'),
  };

  // §4.3 Step 1: Read config
  const config = getConfig();

  // §4.3 Step 1: No config → exit cleanly (AC-09 idempotency)
  if (!config) {
    console.log('No xp-gate installation found');
    return 0;
  }

  // §4.3 Step 1: Already uninstalled → exit cleanly (AC-09 idempotency)
  if (config.mode === 'uninstalled') {
    console.log('No xp-gate installation found');
    return 0;
  }

  // §4.3 Step 2: Determine mode
  let mode = config.mode;
  if (options.forceLocal) mode = 'local';
  if (options.forceGlobal) mode = 'global';

  if (mode !== 'local' && mode !== 'global') {
    console.log('No xp-gate installation found');
    return 0;
  }

  // §4.3 Step 3: Build uninstall plan
  const plan = buildPlan(mode);

  // §4.3 Step 3b: Add purge items if --purge
  const purgeDirs = [];
  if (options.purge) {
    const configDir = CONFIG_DIR;
    const xpGateDir = path.join(HOME_DIR, '.xp-gate');
    purgeDirs.push({ label: '~/.xp-gate/', path: xpGateDir });
    purgeDirs.push({ label: '~/.config/xp-gate/', path: configDir });
    if (mode === 'local') {
      const gitDir = getGitDir();
      if (gitDir) {
        const projectXpGate = path.join(path.dirname(gitDir), '.xp-gate');
        purgeDirs.push({ label: '.xp-gate/ (project)', path: projectXpGate });
      }
    }
  }

  if (plan.length === 0 && purgeDirs.length === 0) {
    console.log('Nothing to uninstall');
    // Still update config to uninstalled
    saveConfig({ ...config, mode: 'uninstalled', uninstalled: new Date().toISOString() });
    return 0;
  }

  // §4.3 Step 4: Print plan
  console.log(`XP-Gate Uninstall (${mode} mode)`);
  console.log('=======================\n');
  console.log('The following will be removed:\n');

  for (const item of plan) {
    console.log(`  • ${item.label}`);
  }
  if (options.purge) {
    console.log('\nPurge mode — additional cleanup:');
    for (const d of purgeDirs) {
      console.log(`  • ${d.label}`);
    }
  }

  // §4.3 Step 5: Dry-run → exit
  if (options.dryRun) {
    console.log('\nDry-run mode — no files were modified');
    return 0;
  }

  // §4.3 Step 6: Confirm
  // Skipped in test environment since we use --force or non-interactive
  // In real usage with TTY, would prompt here

  // §4.8 State machine: active → uninstalling
  saveConfig({ ...config, mode: 'uninstalling' });

  // §4.12 Step 4: Create backup snapshot before destructive operations
  const backupMeta = createBackupSnapshot(plan);

  // §4.12 Execute operations in order (non-destructive first, then destructive)
  let hadErrors = false;

  for (const item of plan) {
    try {
      hadErrors = !executePlanItem(item, config) || hadErrors;
    } catch (e) {
      console.warn(`  Warning: Could not remove ${item.label}: ${e.message}`);
      hadErrors = true;
    }
  }

  if (options.purge) {
    for (const d of purgeDirs) {
      if (options.dryRun) {
        console.log(`  • ${d.label}`);
        continue;
      }
      if (!fs.existsSync(d.path)) continue;
      try {
        fs.rmSync(d.path, { recursive: true, force: true });
        console.log(`  Removed ${d.label}`);
      } catch (e) {
        console.warn(`  Warning: Could not remove ${d.label}: ${e.message}`);
        hadErrors = true;
      }
    }
  }

  // §4.8 State machine: uninstalling → uninstalled
  try {
    saveConfig({
      ...getConfig() || config,
      mode: 'uninstalled',
      uninstalled: new Date().toISOString(),
      manifest: undefined,
    });
  } catch (e) {
    // purge mode: config dir has been deleted, save is non-critical
    if (!options.purge) throw e;
    console.warn(`  Warning: Could not save config: ${e.message}`);
  }

  // §4.12 Step 11: Clean up backup on success
  if (!hadErrors) {
    cleanupBackup(backupMeta);
  }

  // Print summary
  console.log('\nUninstall complete');
  console.log('Note: Qoder Delphi expert agents (.qoder/agents/delphi-*.md) are user-owned files');
  console.log('      that init never overwrites, so they were left in place — delete them by hand');
  console.log('      (then restart the Qoder session) if you want them gone.');
  if (hadErrors) {
    console.log('Some items could not be removed. Run doctor for diagnostics.');
  }

  return 0;
}

/**
 * Decide which installed skill directories an uninstall may remove (#663).
 *
 * `uninstall` never touched skills at all, so 12 of them stayed in
 * ~/.qoder/skills/ and ~/.config/opencode/skills/ after `uninstall --global`, and
 * the next `init` treated them as already installed.
 *
 * Safety rule from the issue: only remove a directory whose content still matches
 * the bundled copy. A user's edits are not residue, and deleting them is a far
 * worse outcome than leaving a stale skill behind -- the user can always delete a
 * leftover, but cannot recover an edit we removed.
 *
 * Returns [{ path, label }] for the directories that are safe to delete.
 */
function planSkillRemovals(skillNames, installedRoot, bundledRoot) {
  const removals = [];
  if (!Array.isArray(skillNames)) return removals;

  for (const name of skillNames) {
    if (typeof name !== 'string' || !name) continue;
    const installedDir = path.join(installedRoot, name);
    const bundledDir = path.join(bundledRoot, name);
    if (!fs.existsSync(installedDir)) continue;
    // No bundled copy to compare against -> cannot prove it is untouched, so keep it.
    if (!fs.existsSync(bundledDir)) continue;
    if (directoryContentMatches(installedDir, bundledDir)) {
      removals.push({ path: installedDir, label: `${installedRoot}/${name}/` });
    }
  }
  return removals;
}

/**
 * True when two directory trees hold the same files with the same bytes.
 * Skips `.git` and node_modules, which are never part of a skill bundle.
 */
function directoryContentMatches(a, b) {
  const filesA = listFilesRelative(a);
  const filesB = listFilesRelative(b);
  if (filesA.length !== filesB.length) return false;
  for (let i = 0; i < filesA.length; i++) {
    if (filesA[i] !== filesB[i]) return false;
    try {
      if (!fs.readFileSync(path.join(a, filesA[i])).equals(fs.readFileSync(path.join(b, filesB[i])))) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

/** Sorted relative file paths under a directory. */
function listFilesRelative(root) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Decide how a hooks directory may be removed (#664).
 *
 * `uninstall` did `rmSync(GLOBAL_HOOKS_DIR, {recursive: true})`. The global
 * `core.hooksPath` is a SHARED directory: `git lfs install` writes its own hooks
 * there, and a recursive delete took them with it. The user then had a broken
 * git-lfs setup and no idea which command caused it — deleting another tool's
 * working files is a worse outcome than leaving residue the user can see.
 *
 * Returns:
 *   { action: 'remove-all', foreign: [] }        — only xp-gate content, safe
 *   { action: 'remove-owned-only', foreign }     — foreign files present, keep them
 *   { action: 'absent', foreign: [] }            — nothing to do
 */
function planHooksDirRemoval(hooksDir) {
  if (!fs.existsSync(hooksDir)) return { action: 'absent', foreign: [] };

  const foreign = [];
  const owned = [];
  let entries;
  try {
    entries = fs.readdirSync(hooksDir, { withFileTypes: true });
  } catch {
    // Unreadable is not "empty": report it as foreign so nothing is deleted blind.
    return { action: 'remove-owned-only', foreign: [{ name: hooksDir, source: null }] };
  }

  for (const entry of entries) {
    const name = entry.name;
    // xp-gate's own hook entry points and support files.
    if (OWNED_HOOK_NAMES.includes(name) || name.endsWith('.sh') || name === 'lib') {
      owned.push(name);
    } else {
      foreign.push({ name, source: foreignHookSource(path.join(hooksDir, name)) });
    }
  }

  return foreign.length > 0
    ? { action: 'remove-owned-only', foreign, owned }
    : { action: 'remove-all', foreign: [], owned };
}

/** Hook entry points xp-gate installs. */
const OWNED_HOOK_NAMES = ['pre-commit', 'pre-push', 'post-merge'];

/** 'git-lfs' when the file proves it, else null. Content-based: see doctor.js. */
function foreignHookSource(filePath) {
  try {
    return /\bgit\s+lfs\b/.test(fs.readFileSync(filePath, 'utf8')) ? 'git-lfs' : null;
  } catch {
    return null;
  }
}

module.exports = { uninstall, isXpGateFile, SIGNATURES, buildPlan, planSkillRemovals, planHooksDirRemoval };
