/**
 * Shared filesystem path constants used across CLI modules.
 * Cross-platform home directory resolution with os.homedir() fallback.
 *
 * @intent Eliminate duplicate path constants in init.js / uninstall.js / detect-deps.js
 * @covers Issue #107 — duplicate code between init.js and uninstall.js
 */
const path = require('path');
const os = require('os');

/**
 * Resolve the user's home directory cross-platform.
 * Fallback chain: HOME → USERPROFILE → os.homedir()
 */
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME_DIR, '.config', 'xp-gate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xp-gate.json');
const TEMPLATE_DIR = path.join(HOME_DIR, '.config', 'opencode', 'git-hooks-template');
const GLOBAL_HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
const GLOBAL_ADAPTERS_DIR = path.join(CONFIG_DIR, 'adapters');

module.exports = {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  TEMPLATE_DIR,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
};
