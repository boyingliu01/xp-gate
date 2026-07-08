const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function install(args = [], cwd = process.cwd()) {
  const isGlobal = args.includes('--global');

  if (isGlobal) {
    return setupGlobal(cwd);
  }
  return setupLocal(cwd);
}

function setupGlobal(cwd) {
  const srcDir = path.dirname(__dirname);

  const globalHooksDir = path.join(require('os').homedir(), '.config', 'xp-gate', 'hooks');
  const globalAdaptersDir = path.join(require('os').homedir(), '.config', 'xp-gate', 'adapters');

  fs.mkdirSync(globalHooksDir, { recursive: true });
  fs.mkdirSync(globalAdaptersDir, { recursive: true });

  copyHooks(srcDir, globalHooksDir);
  copyAdapters(srcDir, globalAdaptersDir);

  try {
    execSync(`git config --global core.hooksPath "${globalHooksDir}"`, { stdio: 'pipe' });
  } catch {}

  console.log('Global installation complete.');
  return 0;
}

function setupLocal(projectRoot) {
  const gitDir = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    console.error('Error: Not a git repository');
    return 1;
  }

  const srcDir = path.dirname(__dirname);
  const hooksDir = path.join(gitDir, 'hooks');
  const githooksDir = path.join(projectRoot, 'githooks');

  copyHooks(srcDir, hooksDir);

  fs.mkdirSync(path.join(githooksDir, 'adapters'), { recursive: true });
  copyAdapters(srcDir, githooksDir);

  console.log('Local installation complete.');
  return 0;
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
  const adapterCommon = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterCommon)) {
    fs.copyFileSync(adapterCommon, path.join(destDir, 'adapter-common.sh'));
  }
  const adaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        fs.copyFileSync(path.join(adaptersDir, f), path.join(destDir, f));
      }
    });
  }
}

module.exports = { install };
