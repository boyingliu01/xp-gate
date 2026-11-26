/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent The invitation to star must never become nagware: it is silent on
 *         CI, silent when piped, at most daily otherwise, and stops for 30
 *         days the moment the user says so.
 * @covers #871
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  NOTICE_TEXT,
  DAY_MS,
  shouldShowNotice,
  configFileFor,
  readConfig,
  maybeShowStarNotice,
} = require('../star-notice');

const NOW = 1_800_000_000_000;

describe('REQ-871 star notice is opt-in by context, never a nag', () => {
  describe('shouldShowNotice', () => {
    it('shows on an interactive run with no prior state', () => {
      expect(shouldShowNotice({ isTTY: true, config: {}, now: NOW })).toBe(true);
    });

    it('stays silent when stdout is not a TTY', () => {
      expect(shouldShowNotice({ isTTY: false, config: {}, now: NOW })).toBe(false);
    });

    it('stays silent on CI', () => {
      expect(shouldShowNotice({ isTTY: true, env: { CI: 'true' }, config: {}, now: NOW })).toBe(false);
    });

    it('honours the NO_UPDATE_NOTIFIER de-facto opt-out', () => {
      expect(shouldShowNotice({ isTTY: true, env: { NO_UPDATE_NOTIFIER: '1' }, config: {}, now: NOW })).toBe(false);
    });

    it('honours XP_GATE_NO_NOTICE', () => {
      expect(shouldShowNotice({ isTTY: true, env: { XP_GATE_NO_NOTICE: '1' }, config: {}, now: NOW })).toBe(false);
    });

    it('never repeats within the same day', () => {
      const config = { starNotice: { lastShownAt: NOW - 1000 } };
      expect(shouldShowNotice({ isTTY: true, config, now: NOW })).toBe(false);
    });

    it('repeats after a day has passed', () => {
      const config = { starNotice: { lastShownAt: NOW - DAY_MS - 1 } };
      expect(shouldShowNotice({ isTTY: true, config, now: NOW })).toBe(true);
    });

    it('stays silent while dismissed', () => {
      const config = { starNotice: { dismissedUntil: NOW + DAY_MS } };
      expect(shouldShowNotice({ isTTY: true, config, now: NOW })).toBe(false);
    });

    it('resumes once the dismissal expires', () => {
      const config = { starNotice: { dismissedUntil: NOW - 1 } };
      expect(shouldShowNotice({ isTTY: true, config, now: NOW })).toBe(true);
    });
  });

  describe('maybeShowStarNotice', () => {
    let homeDir;

    beforeEach(() => {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-star-'));
    });

    afterEach(() => {
      fs.rmSync(homeDir, { recursive: true, force: true });
    });

    it('force prints even without a TTY and records the time', () => {
      const printed = [];
      const shown = maybeShowStarNotice({
        homeDir,
        force: true,
        env: {},
        now: NOW,
        log: (s) => printed.push(s),
      });

      expect(shown).toBe(true);
      expect(printed.join('\n')).toContain(NOTICE_TEXT);
      expect(readConfig(configFileFor(homeDir)).starNotice.lastShownAt).toBe(NOW);
    });

    it('does not print twice for the same forced window', () => {
      const log = () => {};
      expect(maybeShowStarNotice({ homeDir, force: true, env: {}, now: NOW, log })).toBe(true);

      const second = maybeShowStarNotice({
        homeDir,
        env: {},
        now: NOW + 60_000,
        log,
      });
      expect(second).toBe(false);
    });

    it('treats a corrupt config as empty rather than throwing', () => {
      const configFile = configFileFor(homeDir);
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, '{not json', 'utf8');

      expect(() => readConfig(configFile)).not.toThrow();
      expect(readConfig(configFile)).toEqual({});
    });

    it('preserves unrelated config keys when recording', () => {
      const configFile = configFileFor(homeDir);
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ lastInit: 'keep-me' }), 'utf8');

      maybeShowStarNotice({ homeDir, force: true, env: {}, now: NOW, log: () => {} });

      expect(readConfig(configFile).lastInit).toBe('keep-me');
    });
  });
});
