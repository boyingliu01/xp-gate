const fs = require('fs');
const path = require('path');
const { checkDeps } = require('./detect-deps.js');

const CONFIG_DIR = path.join(process.env.HOME, '.config', 'xp-gate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xp-gate.json');
const TEMPLATE_DIR = path.join(process.env.HOME, '.config', 'opencode', 'git-hooks-template');
const GLOBAL_HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
const GLOBAL_ADAPTERS_DIR = path.join(CONFIG_DIR, 'adapters');

function getGitDir() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function updateConfig(updates) {
  let config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  config = { ...config, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function init(args) {
  console.log('XP-Gate Initialization');
  console.log('====================\n');

  const depCheck = await checkDeps();
  if (!depCheck.ok) {
    console.warn('Warning: Missing dependencies');
    if (depCheck.missing) {
      console.warn(`  - ${depCheck.missing} (required)`);
    }
    if (depCheck.versionMismatch) {
      console.warn(`  - ${depCheck.versionMismatch.name}: need ${depCheck.versionMismatch.required}, found ${depCheck.versionMismatch.found}`);
    }
    console.warn('Skills may not work without these dependencies');
    console.warn('Install from: https://github.com/boyingliu01/superpowers\n');
  } else {
    console.log('Dependencies: OK\n');
  }

  // Determine install mode
  const installMode = args.includes('--global') ? 'global' :
                      args.includes('--core-only') ? 'local' :
                      args.includes('--full') ? 'local' : null;

  if (!installMode) {
    console.log('Choose installation mode:');
    console.log('  1) Global  — all git projects use the same hooks (recommended)');
    console.log('  2) Local   — install hooks into current project only\n');
    console.log('Usage:');
    console.log('  xp-gate init --global     # all projects');
    console.log('  xp-gate init              # current project');
    console.log('  xp-gate setup-global      # all projects (alias)\n');
    return 0;
  }

  if (installMode === 'global') {
    return setupGlobal(args);
  }

  // Local (per-project) install
  const gitDir = getGitDir();
  if (!gitDir) {
    console.error('Error: Not a git repository');
    console.error('Run xp-gate init from inside a git repository');
    return 1;
  }

  const projectRoot = path.dirname(gitDir);
  const hooksDir = path.join(projectRoot, '.git', 'hooks');

  console.log(`Mode: Local (per-project)`);
  console.log(`Project: ${projectRoot}`);
  console.log(`Git hooks: ${hooksDir}\n`);

  const srcDir = path.dirname(__dirname);

  console.log('Installing hooks...');
  const hooks = ['pre-commit', 'pre-push'];
  for (const hook of hooks) {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(hooksDir, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
      console.log(`  ${hook} -> ${hooksDir}`);
    }
  }

  // Install adapter infrastructure to project
  fs.mkdirSync(path.join(projectRoot, 'githooks', 'adapters'), { recursive: true });
  const adapterSrc = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterSrc)) {
    fs.copyFileSync(adapterSrc, path.join(projectRoot, 'githooks', 'adapter-common.sh'));
    console.log(`  adapter-common.sh -> ${projectRoot}/githooks/`);
  }

  // Copy adapter scripts
  const adaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        fs.copyFileSync(path.join(adaptersDir, f), path.join(projectRoot, 'githooks', 'adapters', f));
      }
    });
    console.log(`  adapters/*.sh -> ${projectRoot}/githooks/adapters/`);
  }

  // Template backup
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  for (const hook of hooks) {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(TEMPLATE_DIR, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  }
  fs.mkdirSync(path.join(TEMPLATE_DIR, 'adapters'), { recursive: true });

  ensureConfigDir();
  updateConfig({ lastInit: new Date().toISOString(), mode: 'local' });

  console.log('\nInstallation complete!');
  console.log('Run git commit to trigger quality gates');
  return 0;
}

async function setupGlobal(args) {
  console.log('XP-Gate Global Setup');
  console.log('====================\n');

  console.log('Mode: Global (all git projects)');
  console.log(`Global hooks: ${GLOBAL_HOOKS_DIR}`);
  console.log(`Global adapters: ${GLOBAL_ADAPTERS_DIR}\n`);

  const srcDir = path.dirname(__dirname);

  // Create global directories
  fs.mkdirSync(GLOBAL_HOOKS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_ADAPTERS_DIR, { recursive: true });

  // Install hooks to global dir
  console.log('Installing hooks...');
  const hooks = ['pre-commit', 'pre-push'];
  for (const hook of hooks) {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(GLOBAL_HOOKS_DIR, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
      console.log(`  ${hook} -> ${GLOBAL_HOOKS_DIR}`);
    }
  }

  // Install adapter infrastructure globally
  const adapterSrc = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterSrc)) {
    fs.copyFileSync(adapterSrc, path.join(GLOBAL_ADAPTERS_DIR, 'adapter-common.sh'));
    console.log(`  adapter-common.sh -> ${GLOBAL_ADAPTERS_DIR}`);
  }

  const adaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        fs.copyFileSync(path.join(adaptersDir, f), path.join(GLOBAL_ADAPTERS_DIR, f));
      }
    });
    console.log(`  adapters/*.sh -> ${GLOBAL_ADAPTERS_DIR}`);
  }

  // Configure git to use global hooks path
  const { execSync } = require('child_process');
  try {
    execSync(`git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
    console.log(`\n  git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
  } catch (e) {
    console.warn('Warning: Could not set git core.hooksPath config');
  }

  ensureConfigDir();
  updateConfig({ lastInit: new Date().toISOString(), mode: 'global' });

  console.log('\nGlobal setup complete!');
  console.log('All git repositories will now use xp-gate quality gates.');
  console.log('Per-project adapters can still override by creating <repo>/githooks/');
  return 0;
}

module.exports = { init };