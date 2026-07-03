'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Project language detection ─────────────────────────────────────────────

/**
 * Detect whether the project at `dir` is a Python project.
 * Checks for common Python project markers.
 */
function isPythonProject(dir) {
  const markers = ['setup.py', 'setup.cfg', 'pyproject.toml', 'requirements.txt'];
  return markers.some((m) => fs.existsSync(path.join(dir, m)));
}

// ── Config discovery ───────────────────────────────────────────────────────

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

// ── Backend runners ────────────────────────────────────────────────────────

/**
 * Run archlinter (TypeScript/JavaScript): delegates to @archlinter/cli.
 */
function runArchlinter(config) {
  const result = spawnSync(
    'npx',
    ['-y', '@archlinter/cli', 'scan', '.', '--config', config],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (result.error && result.error.code === 'ENOENT') {
    console.error('[xp-gate arch] ERROR: npx not found in PATH. Install Node.js >=18.');
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

/**
 * Run archy (Python): delegates to `archy check --config <config>`.
 * The config is architecture.yaml (archy-compatible format).
 * Falls back to `npx` if archy is not on PATH.
 */
function runArchy(config) {
  // Try direct archy first (pipx/pip installed)
  const result = spawnSync('archy', ['check', '.', '--config', config], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error && result.error.code === 'ENOENT') {
    // Fall back to npx (pipx-injected or pip-installed in environment)
    console.warn(
      '[xp-gate arch] archy not found on PATH; trying npx. Install with: pip install archy',
    );
    const npxResult = spawnSync('npx', ['-y', 'archy', 'check', '.', '--config', config], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (npxResult.error && npxResult.error.code === 'ENOENT') {
      console.error('[xp-gate arch] ERROR: neither archy nor npx found in PATH.');
      return 1;
    }
    return npxResult.status === null ? 1 : npxResult.status;
  }

  return result.status === null ? 1 : result.status;
}

// ── Main entry ─────────────────────────────────────────────────────────────

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

  // Route to the right backend based on project language
  if (isPythonProject(process.cwd())) {
    console.log('[xp-gate arch] Detected Python project — using archy');
    return Promise.resolve(runArchy(config));
  }

  return Promise.resolve(runArchlinter(config));
}

module.exports = { arch };
