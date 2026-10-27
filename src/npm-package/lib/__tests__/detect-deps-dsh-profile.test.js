/**
 * @test REQ-635
 * @intent `xp-gate init` 会向 ~/.dsh/skills 部署技能、npm 包也带 plugins/dsh，
 *         但 PLATFORM_PROFILES 里没有 dsh 条目，getSkillsDirs('dsh') 静默回落到
 *         opencode 的路径，导致 DSH 机器的技能从不被解析（#635）
 * @covers AC-635-04, AC-635-05
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('PLATFORM_PROFILES covers dsh (#635)', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dsh-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // AC-635-04: asking for dsh skills must return the dsh directory, not a
  // silent fallback to opencode's.
  it('getSkillsDirs("dsh") resolves ~/.dsh, not the opencode fallback', () => {
    const { getSkillsDirs } = require('../detect-deps');
    const dirs = getSkillsDirs('dsh');

    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs[0]).toBe(path.join(tmpHome, '.dsh', 'skills'));
    // The pre-fix behaviour: falls through to PLATFORM_PROFILES.opencode.
    expect(dirs[0]).not.toContain(path.join('.config', 'opencode'));
  });

  // AC-635-05: the profile is a real entry, so a caller enumerating platforms
  // sees dsh alongside the three that were already there.
  it('dsh is an enumerable platform profile with skillsDirs and requiredDeps', () => {
    const { PLATFORM_PROFILES, getSkillsDirs } = require('../detect-deps');

    expect(Object.keys(PLATFORM_PROFILES)).toContain('dsh');
    expect(Object.keys(PLATFORM_PROFILES)).toEqual(
      expect.arrayContaining(['opencode', 'claude-code', 'qoder', 'dsh'])
    );

    const profile = PLATFORM_PROFILES.dsh;
    expect(Array.isArray(profile.skillsDirs)).toBe(true);
    expect(profile.requiredDeps).toBeDefined();
    // Profiles store home-relative segments; getSkillsDirs resolves them.
    expect(profile.skillsDirs[0]).toEqual(['.dsh', 'skills']);
    expect(getSkillsDirs('dsh')[0]).toBe(path.join(tmpHome, '.dsh', 'skills'));
  });

  // Every profile must be plain data — no getters mixed in with values, which
  // would break Object.keys()/JSON round-trips and made the object's contract
  // depend on which key you touched (Delphi R1 CI-01).
  it('every profile is plain enumerable data, with no accessor properties', () => {
    const { PLATFORM_PROFILES } = require('../detect-deps');

    for (const name of Object.keys(PLATFORM_PROFILES)) {
      const descriptor = Object.getOwnPropertyDescriptor(PLATFORM_PROFILES, name);
      expect(descriptor.get, `${name} must not be an accessor`).toBeUndefined();
      // A plain value also survives a JSON round-trip unchanged.
      expect(JSON.parse(JSON.stringify(PLATFORM_PROFILES[name]))).toEqual(
        PLATFORM_PROFILES[name]
      );
    }
  });

  // Paths must follow process.env.HOME rather than pinning the home directory
  // at require() time — the trap doctor.js documents at its top.
  it('resolved paths follow a HOME change after require', () => {
    const { getSkillsDirs } = require('../detect-deps');
    // Loaded above with the first tmpHome; move HOME and resolve again.
    const secondHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dsh2-'));
    try {
      process.env.HOME = secondHome;
      expect(getSkillsDirs('dsh')[0]).toBe(path.join(secondHome, '.dsh', 'skills'));
      // The pre-existing profiles must follow too — they used to be frozen at
      // require() time from a destructured HOME_DIR.
      expect(getSkillsDirs('opencode')[0]).toBe(
        path.join(secondHome, '.config', 'opencode', 'skills')
      );
    } finally {
      fs.rmSync(secondHome, { recursive: true, force: true });
    }
  });

  // Anti-vacuity: the three pre-existing profiles must keep their own paths,
  // proving the getter did not disturb them.
  it('leaves the pre-existing profiles unchanged', () => {
    const { getSkillsDirs } = require('../detect-deps');

    expect(getSkillsDirs('opencode')[0]).toBe(
      path.join(tmpHome, '.config', 'opencode', 'skills')
    );
    expect(getSkillsDirs('qoder')[0]).toBe(path.join(tmpHome, '.qoder', 'skills'));
    expect(getSkillsDirs('claude-code')[0]).toBe(path.join(tmpHome, '.claude', 'skills'));
  });
});
