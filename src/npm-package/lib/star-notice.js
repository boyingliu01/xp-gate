/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent A user who already trusts the tool is the one best placed to point
 *         others at it, so the invitation belongs where that trust is formed:
 *         --version, a finished `init`, and a clean `check`.
 * @covers #871
 *
 * Restraint is part of the contract, not a courtesy. The module is silent on
 * CI, silent when stdout is not a TTY, and repeats at most once a day. If the
 * "already shown" timestamp cannot be persisted, the notice stays silent for
 * the rest of the process rather than printing on every invocation -- a
 * failure to record is never allowed to turn into nagging.
 */
const fs = require('fs');
const os = require('os');

const { CONFIG_FILE } = require('./shared-paths.js');

const REPO_URL = 'https://github.com/boyingliu01/xp-gate';
const NOTICE_TEXT = `⭐ If XP-Gate saves you time, a star helps others find it: ${REPO_URL}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a dismissal lasts, in days.
 *
 * `xp-gate star-notice --off` writes this window, so the promised "ask us to
 * stop and we stop" has an actual entry point rather than a hand-edited JSON.
 */
const DISMISS_DAYS = 30;

/**
 * In-process guard: set for the lifetime of the process.
 *
 * When the config cannot be written, the on-disk throttle is unavailable, so
 * without this the notice would print on every call in a loop. One process
 * printing it once is the most we can honestly promise in that state.
 */
let shownInThisProcess = false;

/** Reset the in-process guard. Tests need a clean slate per case. */
function resetProcessGuard() {
  shownInThisProcess = false;
}

/**
 * Decide whether the star invitation may be shown right now.
 *
 * Pure: every input is a parameter. It reads no ambient state, so the policy
 * is testable without faking a terminal.
 *
 * A `lastShownAt` in the future (clock rollback, a restored backup, a shared
 * home across timezones with skewed clocks) is treated as "not yet shown"
 * rather than "shown forever": a stale future timestamp must not silence the
 * notice permanently.
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

  if (notice.lastShownAt) {
    const elapsed = now - notice.lastShownAt;
    // Negative elapsed means the clock moved backwards; let the notice resume.
    if (elapsed >= 0 && elapsed < DAY_MS) return false;
  }

  return true;
}

/**
 * The config file this module reads and writes.
 *
 * Delegates to the canonical GLOBAL_DIRS.CONFIG_FILE so the notice's state
 * lives beside the tool's other settings instead of in a second, silently
 * diverging file.
 *
 * @returns {string}
 */
function configFileFor() {
  return CONFIG_FILE;
}

/**
 * Read the config, tolerating a missing or corrupt file.
 *
 * A broken config must never turn into an uncaught throw on a `--version`
 * call, so every failure here degrades to "no config" (which shows the
 * notice at most daily).
 *
 * @param {string} [configFile]
 * @returns {object}
 */
function readConfig(configFile = configFileFor()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Persist the config.
 *
 * @param {string} configFile
 * @param {object} config
 * @returns {boolean} whether the write succeeded
 */
function writeConfig(configFile, config) {
  try {
    fs.mkdirSync(require('path').dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a dismissal so the notice stays silent for DISMISS_DAYS.
 *
 * @param {{configFile?: string, now?: number}} [opts]
 * @returns {boolean} whether the dismissal was persisted
 */
function dismiss({ configFile = configFileFor(), now = Date.now() } = {}) {
  const config = readConfig(configFile);
  config.starNotice = { ...(config.starNotice || {}), dismissedUntil: now + DISMISS_DAYS * DAY_MS };
  return writeConfig(configFile, config);
}

/**
 * Print the invitation at most once a day, then record that we did.
 *
 * @param {{
 *   configFile?: string,
 *   force?: boolean,
 *   log?: (s: string) => void,
 *   env?: Record<string, string|undefined>,
 *   isTTY?: boolean,
 *   now?: number,
 * }} [opts]
 * @returns {boolean} whether the notice was printed
 */
function maybeShowStarNotice(opts = {}) {
  const {
    configFile = configFileFor(),
    force = false,
    log = (s) => console.log(s),
    env = process.env,
    isTTY = process.stdout.isTTY,
    now = Date.now(),
  } = opts;

  // `force` bypasses the frequency and freshness checks, never the ones that
  // exist to keep the notice out of logs. Forcing it into CI or a pipe would
  // contradict the reason those checks exist.
  const eligible = force
    ? Boolean(isTTY) && !env.CI
    : shouldShowNotice({ isTTY, env, config: readConfig(configFile), now });

  if (!eligible || shownInThisProcess) return false;

  log('');
  log(NOTICE_TEXT);
  shownInThisProcess = true;

  const config = readConfig(configFile);
  config.starNotice = { ...(config.starNotice || {}), lastShownAt: now };
  if (!writeConfig(configFile, config)) {
    // The in-process guard alone now holds the promise: it is the only state
    // we can keep for certain, so no further notice appears this run.
    log(`(could not record the notice in ${configFile}; it will not repeat in this run)`);
  }
  return true;
}

/**
 * Handle the `star-notice` CLI subcommand.
 *
 * @param {string[]} args
 * @returns {number} exit code
 */
function cli(args = []) {
  if (args.includes('--off')) {
    const ok = dismiss();
    if (ok) {
      console.log(`Star notice disabled for ${DISMISS_DAYS} days.`);
      console.log(`Re-enable any time by deleting starNotice from ${configFileFor()}`);
      return 0;
    }
    console.error(`Could not write ${configFileFor()}`);
    return 1;
  }
  if (args.includes('--status')) {
    const { starNotice = {} } = readConfig();
    const now = Date.now();
    const dismissed = starNotice.dismissedUntil && now < starNotice.dismissedUntil;
    console.log(`Config file:      ${configFileFor()}`);
    console.log(`Last shown:       ${starNotice.lastShownAt ? new Date(starNotice.lastShownAt).toISOString() : 'never'}`);
    console.log(`Dismissed until:  ${dismissed ? new Date(starNotice.dismissedUntil).toISOString() : 'not dismissed'}`);
    return 0;
  }
  console.log('Usage: xp-gate star-notice [--off | --status]');
  console.log('  --off     Stop the star invitation for 30 days');
  console.log('  --status  Show when it was last shown and whether it is dismissed');
  return 0;
}

module.exports = {
  REPO_URL,
  NOTICE_TEXT,
  DAY_MS,
  DISMISS_DAYS,
  shouldShowNotice,
  configFileFor,
  readConfig,
  writeConfig,
  dismiss,
  maybeShowStarNotice,
  resetProcessGuard,
  cli,
};
