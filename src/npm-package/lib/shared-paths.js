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
function resolveHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Detect which AI agent platform is currently in use.
 * This is the single implementation; detect-deps.js re-exports it (#424).
 * @returns {'opencode' | 'claude-code' | 'qoder'}
 */
function detectPlatform() {
  const homeDir = resolveHomeDir();
  // Any ~/.qoder content counts as Qoder: a brand-new install has no skills/
  // subdirectory yet, so a skills-only marker misdetects it as opencode and
  // configureQoderDelphiAgents deploys zero Delphi agents (#424).
  if (fs.existsSync(path.join(homeDir, '.qoder'))) return 'qoder';
  if (fs.existsSync(path.join(homeDir, '.claude', 'skills'))) return 'claude-code';
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
  const homeDir = resolveHomeDir();
  const platform = detectPlatform();
  const configDir = platform === 'claude-code' ? '.claude' :
                    platform === 'qoder' ? '.qoder' :
                    path.join('.config', 'opencode');
  return path.join(homeDir, configDir, 'git-hooks-template');
}

// ---------------------------------------------------------------------------
// The constants below are DERIVED FROM THE ENVIRONMENT, so they are computed
// per property access rather than once at require() time.
//
// They used to be plain `const`s evaluated at module load. That made the value
// depend on WHO LOADED THIS MODULE FIRST: detect-deps.js requires shared-paths
// at its own load, so any consumer loaded earlier froze the paths to whatever
// HOME was at that moment. In the doctor test suite that was the REAL home
// directory — detect-deps is loaded in beforeAll, before any test sets HOME —
// so doctor reported `Config file: Not found` for every fixture that had in
// fact written the config, and `--fix` returned 1 on a healthy installation.
//
// A getter keeps the existing `require`-and-destructure call sites working
// (module.exports.CONFIG_FILE still evaluates to a string), while making the
// value follow process.env.HOME.
// ---------------------------------------------------------------------------
function defineLazy(obj, name, compute) {
  Object.defineProperty(obj, name, {
    enumerable: true,
    get: compute,
    // The values are a pure function of the environment; caching them for the
    // lifetime of the process would reintroduce the bug fixed here.
    configurable: true,
  });
}

const GLOBAL_DIRS = {
  CONFIG_DIR: () => path.join(resolveHomeDir(), '.config', 'xp-gate'),
  GLOBAL_HOOKS_DIR: () => path.join(GLOBAL_DIRS.CONFIG_DIR(), 'hooks'),
  GLOBAL_ADAPTERS_DIR: () => path.join(GLOBAL_DIRS.CONFIG_DIR(), 'adapters'),
  GLOBAL_MODULES_DIR: () => path.join(GLOBAL_DIRS.CONFIG_DIR(), 'modules'),
};

// Base name for the other derived paths.
GLOBAL_DIRS.CONFIG_FILE = () => path.join(GLOBAL_DIRS.CONFIG_DIR(), 'xp-gate.json');

const exportsObj = {
  detectPlatform,
  getTemplateDir,
  resolveHomeDir,
};

defineLazy(exportsObj, 'HOME_DIR', () => resolveHomeDir());
for (const [name, compute] of Object.entries(GLOBAL_DIRS)) {
  defineLazy(exportsObj, name, compute);
}
defineLazy(exportsObj, 'TEMPLATE_DIR', () => getTemplateDir());

module.exports = exportsObj;
