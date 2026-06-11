'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Looks for architecture.yaml in CWD, then walks up to git root.
function findArchConfig(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, 'architecture.yaml');
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    dir = path.dirname(dir);
  }
  return null;
}

function arch(args) {
  const configIdx = args.indexOf('--config');
  const explicitConfig = configIdx >= 0 ? args[configIdx + 1] : null;
  const config = explicitConfig || findArchConfig(process.cwd());

  if (!config) {
    console.error('[xp-gate arch] ERROR: architecture.yaml not found in CWD or git root');
    console.error('  Create one or pass --config <path>');
    return Promise.resolve(1);
  }

  if (!fs.existsSync(config)) {
    console.error(`[xp-gate arch] ERROR: config file not found: ${config}`);
    return Promise.resolve(1);
  }

  const result = spawnSync('npx', ['-y', '@archlinter/cli', 'scan', '.', '--config', config], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error && result.error.code === 'ENOENT') {
    console.error('[xp-gate arch] ERROR: npx not found in PATH. Install Node.js >=18.');
    return Promise.resolve(1);
  }

  return Promise.resolve(result.status === null ? 1 : result.status);
}

module.exports = { arch };
