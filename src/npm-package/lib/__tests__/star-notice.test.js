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
  DISMISS_DAYS,
  shouldShowNotice,
  configFileFor,
  readConfig,
  dismiss,
  maybeShowStarNotice,
  resetProcessGuard,
} = require('../star-notice');
const { CONFIG_FILE } = require('../shared-paths');

const NOW = 1_800_000_000_000;
// One printed notice costs three log lines: a blank line, the text, and the
// "could not record" warning. More than that means the guard let it through again.
const MAX_LINES_PER_PRINTED_NOTICE = 3;

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

    it('resumes when the recorded time is in the future (clock rollback)', () => {
      // A future timestamp must not silence the notice forever: the machine
      // that wrote it may be wrong, and the user may have restored a backup.
      const config = { starNotice: { lastShownAt: NOW + 10 * DAY_MS } };
      expect(shouldShowNotice({ isTTY: true, config, now: NOW })).toBe(true);
    });
  });

  describe('config location', () => {
    it('uses the canonical GLOBAL_DIRS.CONFIG_FILE, not a second path', () => {
      expect(configFileFor()).toBe(CONFIG_FILE);
    });

    it('lives under ~/.config/xp-gate', () => {
      expect(configFileFor()).toContain(path.join('.config', 'xp-gate', 'xp-gate.json'));
    });
  });

  describe('dismiss', () => {
    let configFile;

    beforeEach(() => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-dismiss-'));
      configFile = path.join(home, 'xp-gate.json');
    });

    afterEach(() => {
      fs.rmSync(path.dirname(configFile), { recursive: true, force: true });
      resetProcessGuard();
    });

    it('writes a window of DISMISS_DAYS and survives a real read', () => {
      expect(dismiss({ configFile, now: NOW })).toBe(true);

      const { starNotice } = readConfig(configFile);
      expect(starNotice.dismissedUntil).toBe(NOW + DISMISS_DAYS * DAY_MS);

      expect(shouldShowNotice({ isTTY: true, config: readConfig(configFile), now: NOW })).toBe(false);
    });

    it('reports failure when the config cannot be written', () => {
      const missingParent = path.join(path.dirname(configFile), 'a-file');
      fs.writeFileSync(missingParent, 'not a directory');
      expect(dismiss({ configFile: path.join(missingParent, 'xp-gate.json'), now: NOW })).toBe(false);
    });
  });

  describe('maybeShowStarNotice', () => {
    let configFile;

    beforeEach(() => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-star-'));
      configFile = path.join(home, 'xp-gate.json');
      resetProcessGuard();
    });

    afterEach(() => {
      fs.rmSync(path.dirname(configFile), { recursive: true, force: true });
      resetProcessGuard();
    });

    it('prints on a TTY and records the time', () => {
      const printed = [];
      const shown = maybeShowStarNotice({
        configFile,
        isTTY: true,
        env: {},
        now: NOW,
        log: (s) => printed.push(s),
      });

      expect(shown).toBe(true);
      expect(printed.join('\n')).toContain(NOTICE_TEXT);
      expect(readConfig(configFile).starNotice.lastShownAt).toBe(NOW);
    });

    it('does not print twice in one process even without force', () => {
      const log = () => {};
      expect(maybeShowStarNotice({ configFile, isTTY: true, env: {}, now: NOW, log })).toBe(true);
      expect(maybeShowStarNotice({ configFile, isTTY: true, env: {}, now: NOW + DAY_MS * 2, log })).toBe(false);
    });

    it('honours isTTY passed in rather than consulting the real terminal', () => {
      const log = () => {};
      // A piped process must stay silent even though the caller passed nothing.
      expect(maybeShowStarNotice({ configFile, isTTY: false, env: {}, now: NOW, log })).toBe(false);
    });

    it('force cannot push the notice into CI or a pipe', () => {
      const log = () => {};
      expect(maybeShowStarNotice({ configFile, force: true, isTTY: true, env: { CI: 'true' }, now: NOW, log })).toBe(false);
      resetProcessGuard();
      expect(maybeShowStarNotice({ configFile, force: true, isTTY: false, env: {}, now: NOW, log })).toBe(false);
    });

    describe('when the config cannot be written', () => {
      it('still prints once, says so, and never claims a silent success', () => {
        const parentAsFile = path.join(path.dirname(configFile), 'blocked');
        fs.writeFileSync(parentAsFile, 'not a directory');
        const blockedConfig = path.join(parentAsFile, 'xp-gate.json');
        const printed = [];

        const shown = maybeShowStarNotice({
          configFile: blockedConfig,
          isTTY: true,
          env: {},
          now: NOW,
          log: (s) => printed.push(s),
        });

        expect(shown).toBe(true);
        const output = printed.join('\n');
        expect(output).toContain(NOTICE_TEXT);
        expect(output).toContain('could not record');
      });

      it('does not nag on the next call in the same process', () => {
        const parentAsFile = path.join(path.dirname(configFile), 'blocked');
        fs.writeFileSync(parentAsFile, 'not a directory');
        const blockedConfig = path.join(parentAsFile, 'xp-gate.json');
        let count = 0;
        const log = () => { count += 1; };

        maybeShowStarNotice({ configFile: blockedConfig, isTTY: true, env: {}, now: NOW, log });
        maybeShowStarNotice({ configFile: blockedConfig, isTTY: true, env: {}, now: NOW, log });
        maybeShowStarNotice({ configFile: blockedConfig, isTTY: true, env: {}, now: NOW, log });

        // One blank line + one notice + one warning line per printed notice.
        expect(count).toBeLessThanOrEqual(MAX_LINES_PER_PRINTED_NOTICE);
      });
    });

    it('treats a corrupt config as empty rather than throwing', () => {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, '{not json', 'utf8');

      expect(() => readConfig(configFile)).not.toThrow();
      expect(readConfig(configFile)).toEqual({});
      expect(() => maybeShowStarNotice({ configFile, isTTY: true, env: {}, now: NOW, log: () => {} })).not.toThrow();
    });

    it('preserves unrelated config keys when recording', () => {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ lastInit: 'keep-me' }), 'utf8');

      maybeShowStarNotice({ configFile, isTTY: true, env: {}, now: NOW, log: () => {} });

      expect(readConfig(configFile).lastInit).toBe('keep-me');
    });
  });
});
