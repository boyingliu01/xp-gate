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

/**
 * README badge markup offered once a project's gates come back clean.
 *
 * A badge is the cheapest honest claim a project can make about itself: it
 * shows a passing gate, not a promise. That is why it is offered only after a
 * run where nothing failed -- the markup would be false otherwise.
 */
const BADGE_SHIELD_URL = 'https://img.shields.io/badge/gated%20by-XP--Gate-blueviolet';
const BADGE_MARKDOWN = `[![gated by XP-Gate](${BADGE_SHIELD_URL})](${REPO_URL})`;
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

  // `force` bypasses the frequency and freshness checks and nothing else. It
  // must still honour an explicit opt-out (`--off`, the env switches) and the
  // guards that keep the notice out of logs: a user who asked us to stop has
  // asked regardless of who is forcing.
  const config = readConfig(configFile);
  const optedOut = Boolean(env.CI || env.NO_UPDATE_NOTIFIER || env.XP_GATE_NO_NOTICE)
    || Boolean(config.starNotice && config.starNotice.dismissedUntil && now < config.starNotice.dismissedUntil);
  const eligible = force ? Boolean(isTTY) && !optedOut : shouldShowNotice({ isTTY, env, config, now });

  if (!eligible || shownInThisProcess) return false;

  log('');
  log(NOTICE_TEXT);
  shownInThisProcess = true;

  config.starNotice = { ...(config.starNotice || {}), lastShownAt: now };
  if (!writeConfig(configFile, config)) {
    // The in-process guard alone now holds the promise: it is the only state
    // we can keep for certain, so no further notice appears this run.
    log(`(could not record the notice in ${configFile}; it will not repeat in this run)`);
  }
  return true;
}

/**
 * Offer the README badge after a run where every gate passed.
 *
 * Deliberately silent in more places than the star notice is:
 *
 *   - never on a failing run (the markup would be a false claim)
 *   - never when the project already carries the badge (it is advice, not news)
 *   - never in CI or a pipe, same as the notice
 *   - at most once per badge-offer day, tracked separately from the notice, so
 *     accepting one does not silence the other
 *
 * @param {{
 *   projectRoot?: string,
 *   configFile?: string,
 *   force?: boolean,
 *   log?: (s: string) => void,
 *   env?: Record<string, string|undefined>,
 *   isTTY?: boolean,
 *   now?: number,
 * }} [opts]
 * @returns {boolean} whether the badge was offered
 */
function maybeOfferBadge(opts = {}) {
  const {
    projectRoot = process.cwd(),
    configFile = configFileFor(),
    force = false,
    log = (s) => console.log(s),
    env = process.env,
    isTTY = process.stdout.isTTY,
    now = Date.now(),
  } = opts;

  const config = readConfig(configFile);
  const badgeNotice = config.badgeOffer || {};

  // The badge keeps its OWN clock. Reusing shouldShowNotice would read
  // `starNotice.lastShownAt` -- which the star invitation writes moments earlier
  // in the same run -- and conclude the badge had already been offered. Measured
  // 2026-11-26: the badge never printed after a clean check for exactly this
  // reason, while the star line did.
  //
  // Only the dismiss window is shared: a user who ran `--off` has asked for
  // silence about the project, and that covers both.
  const dismissed = Boolean(config.starNotice
    && config.starNotice.dismissedUntil
    && now < config.starNotice.dismissedUntil);
  const optedOut = Boolean(env.CI || env.NO_UPDATE_NOTIFIER || env.XP_GATE_NO_NOTICE) || dismissed;

  // `force` bypasses the frequency and freshness checks and nothing else. It
  // must still honour an explicit opt-out and the "already carries it" check:
  // telling someone to claim what they have already claimed is not advice, and
  // forcing it into CI puts the markup in a log nobody reads.
  const eligible = Boolean(isTTY) && !optedOut;
  if (!eligible) return false;
  if (alreadyBadged(projectRoot)) return false;

  // The frequency check must come BEFORE the first log line: printing and then
  // deciding not to record would show the advice on every run.
  if (!force && badgeNotice.lastShownAt && now - badgeNotice.lastShownAt < DAY_MS) return false;

  log('');
  log('✅ Every gate passed. Claim it in your README:');
  log(`   ${BADGE_MARKDOWN}`);

  config.badgeOffer = { ...badgeNotice, lastShownAt: now };
  writeConfig(configFile, config);
  return true;
}

/**
 * Whether the project's README already carries the badge.
 *
 * A missing or unreadable README is not an error -- it just means the project
 * has not made the claim, so the offer stands.
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
function alreadyBadged(projectRoot) {
  let readme;
  try {
    readme = fs.readFileSync(require('path').join(projectRoot, 'README.md'), 'utf8');
  } catch {
    // A missing README means the project has not made the claim, so the offer
    // stands. An unreadable one (permissions, I/O) is deliberately treated the
    // same: the alternative is to nag forever when the file cannot be read, and
    // the offer is harmless -- it only prints the markup for a human to paste.
    return false;
  }
  // Match the BADGE, not the project. An earlier draft used
  // `readme.includes('boyingliu01/xp-gate')`, which is true of any README that
  // mentions the repo in prose -- "built on boyingliu01/xp-gate", a credits
  // line, a link-back. Those projects were silently treated as already badged
  // and never told how to make the claim they could honestly make.
  //
  // The distinguishing part is the SHIELD IMAGE URL: prose never contains it.
  return readme.includes(BADGE_SHIELD_URL) || readme.includes(BADGE_MARKDOWN);
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
  maybeOfferBadge,
  alreadyBadged,
  BADGE_MARKDOWN,
  BADGE_SHIELD_URL,
  resetProcessGuard,
  cli,
};
