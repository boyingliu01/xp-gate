const fs = require('fs');
const path = require('path');
const { checkDeps } = require('./detect-deps.js');

const CONFIG_DIR = path.join(process.env.HOME, '.config', 'xgate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xgate.json');
const TEMPLATE_DIR = path.join(process.env.HOME, '.config', 'opencode', 'git-hooks-template');

async function init(args) {
  console.log('XGate Initialization');
  console.log('====================\n');
  
  const installMode = args.includes('--core-only') ? 'core' : 
                     args.includes('--full') ? 'full' : 'interactive';
  
  const gitDir = getGitDir();
  if (!gitDir) {
    console.error('Error: Not a git repository');
    console.error('Run xgate init from inside a git repository');
    return 1;
  }
  
  const projectRoot = path.dirname(gitDir);
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  
  console.log(`Project: ${projectRoot}`);
  console.log(`Git hooks: ${hooksDir}\n`);
  
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
  
  const templateChoice = args.includes('--no-template') ? false : true;
  
  console.log('Installing hooks...');
  
  const srcDir = path.dirname(__dirname);
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
  
  const adaptersDir = path.join(projectRoot, 'githooks', 'adapters');
  fs.mkdirSync(adaptersDir, { recursive: true });
  
  const adapterSrc = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterSrc)) {
    fs.copyFileSync(adapterSrc, path.join(projectRoot, 'githooks', 'adapter-common.sh'));
    console.log(`  adapter-common.sh -> ${projectRoot}/githooks/`);
  }
  
  if (templateChoice) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    for (const hook of hooks) {
      const src = path.join(srcDir, 'hooks', hook);
      const dest = path.join(TEMPLATE_DIR, hook);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
        console.log(`  ${hook} -> ${TEMPLATE_DIR}`);
      }
    }
    fs.mkdirSync(path.join(TEMPLATE_DIR, 'adapters'), { recursive: true });
  }
  
  ensureConfigDir();
  updateConfig({ lastInit: new Date().toISOString() });
  
  console.log('\nInstallation complete!');
  console.log('Run git commit to trigger quality gates');
  
  return 0;
}

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

module.exports = { init };