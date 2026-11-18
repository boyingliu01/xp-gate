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
 *
 * #635 follow-up: DSH used to be undetectable here. The original reasoning was
 * "there is no marker it could key on that opencode's would not also match",
 * which is true of `<root>/skills` (every platform has one) but false of DSH's
 * own bookkeeping directories. `~/.dsh/profiles` and `~/.dsh/.shim` are created
 * by DSH alone. Without a `dsh` branch this function could never return 'dsh'
 * even on a DSH-only machine, so every caller holding its result —
 * `install-skill`, `checkDeps`, `getTemplateDir` — targeted `~/.config/opencode`
 * instead: skills landed in a directory the running agent never reads, and
 * `install-skill` failed outright with "superpowers is required but not
 * installed" because the dependency check looked in that same phantom tree.
 *
 * DSH is checked BEFORE the others: a machine running DSH alongside Qoder or
 * OpenCode must still resolve to DSH when `~/.dsh` carries its profile/shim
 * state, because that is the agent whose `skills/` the user is actually reading.
 *
 * @returns {'opencode' | 'claude-code' | 'qoder' | 'dsh'}
 */
function detectPlatform() {
  const homeDir = resolveHomeDir();
  // DSH markers: `profiles` (profile system) and `.shim` (bash shims). Both are
  // written by DSH itself and by nothing else, so unlike `<root>/skills` they
  // cannot collide with opencode/qoder/claude installs (#635 follow-up).
  if (
    fs.existsSync(path.join(homeDir, '.dsh', 'profiles')) ||
    fs.existsSync(path.join(homeDir, '.dsh', '.shim'))
  ) {
    return 'dsh';
  }
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
 *   - opencode:    ~/.config/opencode/git-hooks-template
 *   - claude-code: ~/.claude/git-hooks-template
 *   - qoder:       ~/.qoder/git-hooks-template
 *   - dsh:         ~/.dsh/git-hooks-template
 *
 * This prevents templateDir from pointing to a stale platform's directory
 * after migrating from one AI agent to another (e.g., OpenCode → Qoder).
 *
 * #635 follow-up: `dsh` needs its own row rather than falling through to
 * `~/.config/opencode`. On a DSH-only machine that fallback wrote the templates
 * into a directory the agent never reads and left the config's `templateDir`
 * pointing at a path that does not exist — `doctor` then reported `templateDir`
 * as a hard FAIL on an otherwise healthy install.
 *
 * @returns {string} Path to the platform-specific git hooks template directory
 */
const PLATFORM_CONFIG_SEGMENTS = {
  'claude-code': ['.claude'],
  qoder: ['.qoder'],
  dsh: ['.dsh'],
  opencode: ['.config', 'opencode'],
};

function getTemplateDir() {
  const homeDir = resolveHomeDir();
  const segments = PLATFORM_CONFIG_SEGMENTS[detectPlatform()] || ['.config', 'opencode'];
  return path.join(homeDir, ...segments, 'git-hooks-template');
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
