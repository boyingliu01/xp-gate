/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent A user who already trusts the tool is the one best placed to point
 *         others at it, so the invitation belongs where that trust is formed:
 *         --version, a finished `init`, and a clean `check`.
 * @covers #871
 *
 * The notice is deliberately hard to get wrong:
 *   - never printed on a non-interactive run (CI logs are not an audience)
 *   - never printed when stdout is not a TTY (piped, redirected)
 *   - at most once per day, recorded in the user's own config
 *   - suppressed for 30 days once the user asks us to stop
 *   - honours the de-facto NO_UPDATE_NOTIFIER opt-out
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_URL = 'https://github.com/boyingliu01/xp-gate';
const NOTICE_TEXT = `⭐ If XP-Gate saves you time, a star helps others find it: ${REPO_URL}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether the star invitation may be shown right now.
 *
 * Pure: takes the environment and a clock, reads no ambient state.
 *
 * @param {{isTTY?: boolean, env?: Record<string, string|undefined>, config?: object, now?: number}} ctx
 * @returns {boolean}
 */
function shouldShowNotice({ isTTY, env = {}, config = {}, now = Date.now() } = {}) {
  if (!isTTY) return false;
  if (env.CI) return false;
  if (env.NO_UPDATE_NOTIFIER) return false;
  if (env.XP_GATE_NO_NOTICE) return false;

  const notice = config.starNotice;
  if (!notice || typeof notice !== 'object') return true;

  if (notice.dismissedUntil && now < notice.dismissedUntil) return false;
  if (notice.lastShownAt && now - notice.lastShownAt < DAY_MS) return false;

  return true;
}

/** Where the notice's bookkeeping lives. Mirrors GLOBAL_DIRS.CONFIG_FILE. */
function configFileFor(homeDir) {
  return path.join(homeDir, '.config', 'xp-gate', 'xp-gate.json');
}

/**
 * Read the config, tolerating a missing or corrupt file.
 *
 * A broken config must never turn into an uncaught throw on a `--version`
 * call, so every failure here degrades to "no config" (which shows the
 * notice at most daily).
 */
function readConfig(configFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(configFile, config) {
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Print the invitation at most once a day, then record that we did.
 *
 * @param {{homeDir?: string, force?: boolean, log?: (s: string) => void}} [opts]
 * @returns {boolean} whether the notice was printed
 */
function maybeShowStarNotice(opts = {}) {
  const {
    homeDir = os.homedir(),
    force = false,
    log = (s) => console.log(s),
    env = process.env,
    now = Date.now(),
  } = opts;

  const configFile = configFileFor(homeDir);
  const config = readConfig(configFile);

  if (!force && !shouldShowNotice({ isTTY: process.stdout.isTTY, env, config, now })) {
    return false;
  }

  log('');
  log(NOTICE_TEXT);

  config.starNotice = { ...(config.starNotice || {}), lastShownAt: now };
  writeConfig(configFile, config);
  return true;
}

module.exports = {
  REPO_URL,
  NOTICE_TEXT,
  DAY_MS,
  shouldShowNotice,
  configFileFor,
  readConfig,
  writeConfig,
  maybeShowStarNotice,
};
