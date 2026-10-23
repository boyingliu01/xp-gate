/**
 * @test REQ-2 xp-gate doctor
 * @intent Prove that the path constants follow process.env.HOME even when
 *         another module loaded shared-paths.js first (the doctor.test.js bug:
 *         detect-deps.js is loaded in beforeAll, before any HOME is set, which
 *         pinned CONFIG_FILE to the REAL home for the rest of the suite).
 * @covers AC-05, AC-08, AC-10
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('shared-paths resolves the home directory lazily', () => {
  let originalHome;
  let tmpA;
  let tmpB;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-a-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-b-'));
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    for (const d of [tmpA, tmpB]) {
      if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    vi.resetModules();
  });

  function freshSharedPaths() {
    const p = require.resolve('../shared-paths');
    delete require.cache[p];
    return require('../shared-paths');
  }

  it('CONFIG_FILE follows a HOME change made after the module was first loaded', () => {
    process.env.HOME = tmpA;
    const first = freshSharedPaths();
    expect(first.CONFIG_FILE).toBe(path.join(tmpA, '.config', 'xp-gate', 'xp-gate.json'));

    // A second "test" changes HOME — the same module object must now reflect it.
    process.env.HOME = tmpB;
    expect(first.CONFIG_FILE).toBe(
      path.join(tmpB, '.config', 'xp-gate', 'xp-gate.json'),
      'CONFIG_FILE still points at the HOME value captured at require() time'
    );
  });

  it('HOME_DIR follows a HOME change made after the module was first loaded', () => {
    process.env.HOME = tmpA;
    const sp = freshSharedPaths();
    expect(sp.HOME_DIR).toBe(tmpA);
    process.env.HOME = tmpB;
    expect(sp.HOME_DIR).toBe(tmpB, 'HOME_DIR is frozen at require() time');
  });

  it('a fresh require after a HOME change also reflects it (regression guard)', () => {
    process.env.HOME = tmpA;
    freshSharedPaths();
    process.env.HOME = tmpB;
    const sp = freshSharedPaths();
    expect(sp.CONFIG_FILE).toBe(path.join(tmpB, '.config', 'xp-gate', 'xp-gate.json'));
  });
});
