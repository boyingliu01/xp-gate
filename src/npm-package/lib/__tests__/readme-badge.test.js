/**
 * @test Issues #871 README badge offered after a clean run
 * @intent A badge is the cheapest honest claim a project can make about itself:
 *         it shows a passing gate. Offering the markup after a run where
 *         something failed would make the claim false, so the offer rides
 *         strictly on the all-gates-passed branch.
 *
 *         It is silent in more places than the star notice is, because advice
 *         is easier to get wrong than an invitation:
 *
 *           - never on a failing run (the markup would be a lie)
 *           - never when the README already carries it (advice, not news)
 *           - never in CI or a pipe
 *           - at most once a day, tracked separately from the star notice, so
 *             accepting one does not silence the other
 * @covers AC-BADGE-01, AC-BADGE-02, AC-BADGE-03
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BADGE_MARKDOWN,
  DAY_MS,
  maybeOfferBadge,
  maybeShowStarNotice,
  alreadyBadged,
  readConfig,
  resetProcessGuard,
} = require('../star-notice');

const NOW = 1_800_000_000_000;

/** @returns {{dir: string, configFile: string}} an isolated project + config */
function makeFixture(readmeBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-badge-'));
  const configFile = path.join(dir, 'cfg', 'xp-gate.json');
  if (readmeBody !== null) {
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), readmeBody);
    } catch (err) {
      throw new Error(`badge fixture: ${err.message}`);
    }
  }
  return { dir, configFile };
}

describe('REQ-BADGE a badge is offered only when the claim would be true', () => {
  let fixture;
  let printed;

  beforeEach(() => {
    resetProcessGuard();
    fixture = makeFixture('# Demo project\n');
    printed = [];
  });

  afterEach(() => {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  });

  const offer = (overrides = {}) => maybeOfferBadge({
    projectRoot: fixture.dir,
    configFile: fixture.configFile,
    isTTY: true,
    env: {},
    now: NOW,
    log: (s) => printed.push(s),
    ...overrides,
  });

  test('AC-BADGE-01: offers the exact markup on a clean run', () => {
    expect(offer()).toBe(true);

    const out = printed.join('\n');
    expect(out).toContain(BADGE_MARKDOWN);
    expect(out).toContain('Every gate passed');
  });

  test('AC-BADGE-02: stays silent when stdout is not a TTY', () => {
    expect(offer({ isTTY: false })).toBe(false);
    expect(printed).toEqual([]);
  });

  test('AC-BADGE-02: stays silent on CI', () => {
    expect(offer({ env: { CI: 'true' } })).toBe(false);
    expect(printed).toEqual([]);
  });

  test('AC-BADGE-02: stays silent when the user asked us to stop', () => {
    try {
      fs.mkdirSync(path.dirname(fixture.configFile), { recursive: true });
      fs.writeFileSync(fixture.configFile, JSON.stringify({
        starNotice: { dismissedUntil: NOW + DAY_MS },
      }));
    } catch (err) {
      throw new Error(`fixture: ${err.message}`);
    }

    expect(offer()).toBe(false);
    expect(printed).toEqual([]);
  });

  test('AC-BADGE-02: force cannot override an explicit opt-out', () => {
    // `force` exists for tests and explicit CLI invocations. A user who ran
    // `--off` has opted out regardless of who is forcing, so the dismissal
    // must hold on the forced path too -- that is the branch a bare
    // `shouldShowNotice` call would not exercise.
    try {
      fs.mkdirSync(path.dirname(fixture.configFile), { recursive: true });
      fs.writeFileSync(fixture.configFile, JSON.stringify({
        starNotice: { dismissedUntil: NOW + DAY_MS },
      }));
    } catch (err) {
      throw new Error(`fixture: ${err.message}`);
    }

    expect(offer({ force: true })).toBe(false);
    expect(printed).toEqual([]);
  });

  test('AC-BADGE-02: does not repeat within the same day', () => {
    expect(offer()).toBe(true);
    printed = [];

    expect(offer({ now: NOW + 60_000 })).toBe(false);
    expect(printed).toEqual([]);
  });

  test('AC-BADGE-02: repeats after a day', () => {
    offer();
    // A new process would start with a clean guard; simulate that.
    resetProcessGuard();
    printed = [];

    expect(offer({ now: NOW + DAY_MS + 1 })).toBe(true);
  });

  describe('alreadyBadged', () => {
    test('AC-BADGE-03: recognises the badge the offer itself prints', () => {
      // The markup offered must be the markup recognised, or a project that
      // accepted the advice would be told again every day.
      const accepted = makeFixture(`# Demo\n\n${BADGE_MARKDOWN}\n`);
      try {
        expect(alreadyBadged(accepted.dir)).toBe(true);
      } finally {
        fs.rmSync(accepted.dir, { recursive: true, force: true });
      }
    });

    test('AC-BADGE-03: a project without the badge is offered it', () => {
      expect(alreadyBadged(fixture.dir)).toBe(false);
    });

    test('AC-BADGE-03: a missing README is not an error', () => {
      const bare = makeFixture(null);
      try {
        expect(() => alreadyBadged(bare.dir)).not.toThrow();
        expect(alreadyBadged(bare.dir)).toBe(false);
      } finally {
        fs.rmSync(bare.dir, { recursive: true, force: true });
      }
    });

    test('AC-BADGE-03: does not offer to a project that already carries it', () => {
      const accepted = makeFixture(`# Demo\n\n${BADGE_MARKDOWN}\n`);
      try {
        printed = [];
        const shown = maybeOfferBadge({
          projectRoot: accepted.dir,
          configFile: path.join(accepted.dir, 'cfg.json'),
          isTTY: true,
          env: {},
          now: NOW,
          log: (s) => printed.push(s),
        });
        expect(shown).toBe(false);
        expect(printed).toEqual([]);
      } finally {
        fs.rmSync(accepted.dir, { recursive: true, force: true });
      }
    });
  });

  test('AC-BADGE-02: the badge still appears right after the star notice did', () => {
    // The real sequence inside a clean `check`: maybeShowStarNotice() runs first
    // and writes `starNotice.lastShownAt`, then the badge is offered in the same
    // process moments later.
    //
    // An earlier draft reused shouldShowNotice() for the badge, which reads that
    // very field and concluded the badge had already been offered. Measured
    // 2026-11-26: the badge never printed after a clean check, while the star
    // line did -- and every unit test passed, because none of them ran the two
    // in sequence. This test is that sequence.
    expect(maybeShowStarNotice({
      configFile: fixture.configFile,
      isTTY: true,
      env: {},
      now: NOW,
      log: () => {},
    })).toBe(true);

    expect(offer({ now: NOW + 5 })).toBe(true);
    expect(printed.join('\n')).toContain(BADGE_MARKDOWN);
  });

  test('AC-BADGE-02: the badge and the star notice keep separate clocks', () => {
    // Accepting one must not silence the other: they answer different questions
    // ("does this work?" vs "should I point others at it?").
    offer();
    const config = readConfig(fixture.configFile);
    expect(config.badgeOffer.lastShownAt).toBe(NOW);
    expect(config.starNotice).toBeUndefined();
  });
});
