const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { copyHooks, copyAdapters } = require('./shared-utils');

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
  } catch (err) {
    console.warn(`  Warning: Could not set global core.hooksPath: ${err.message}`);
  }

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

module.exports = { install };
