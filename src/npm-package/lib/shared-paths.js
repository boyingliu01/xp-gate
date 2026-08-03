/**
 * Shared filesystem path constants used across CLI modules.
 * Cross-platform home directory resolution with os.homedir() fallback.
 *
 * @intent Eliminate duplicate path constants in init.js / uninstall.js / detect-deps.js
 * @covers Issue #107 — duplicate code between init.js and uninstall.js
 * @covers Issue #188 — templateDir pointing to OpenCode residue path
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Resolve the user's home directory cross-platform.
 * Fallback chain: HOME → USERPROFILE → os.homedir()
 */
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME_DIR, '.config', 'xp-gate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xp-gate.json');
const GLOBAL_HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
const GLOBAL_ADAPTERS_DIR = path.join(CONFIG_DIR, 'adapters');
const GLOBAL_MODULES_DIR = path.join(CONFIG_DIR, 'modules');

/**
 * Detect which AI agent platform is currently in use.
 * Mirrors detectPlatform() in detect-deps.js to avoid circular deps.
 * @returns {'opencode' | 'claude-code' | 'qoder'}
 */
function detectPlatform() {
  if (fs.existsSync(path.join(HOME_DIR, '.qoder', 'skills'))) return 'qoder';
  if (fs.existsSync(path.join(HOME_DIR, '.claude', 'skills'))) return 'claude-code';
  return 'opencode';
}

/**
 * Get the git hooks template directory for the current platform.
 * Each AI agent platform has its own config directory:
 *   - opencode:   ~/.config/opencode/git-hooks-template
 *   - claude-code: ~/.claude/git-hooks-template
 *   - qoder:      ~/.qoder/git-hooks-template
 *
 * This prevents templateDir from pointing to a stale platform's directory
 * after migrating from one AI agent to another (e.g., OpenCode → Qoder).
 *
 * @returns {string} Path to the platform-specific git hooks template directory
 */
function getTemplateDir() {
  const platform = detectPlatform();
  const configDir = platform === 'claude-code' ? '.claude' :
                    platform === 'qoder' ? '.qoder' :
                    path.join('.config', 'opencode');
  return path.join(HOME_DIR, configDir, 'git-hooks-template');
}

const TEMPLATE_DIR = getTemplateDir();

module.exports = {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  TEMPLATE_DIR,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
  GLOBAL_MODULES_DIR,
  detectPlatform,
  getTemplateDir,
};
