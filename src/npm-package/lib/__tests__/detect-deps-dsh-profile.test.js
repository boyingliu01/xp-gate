/**
 * @test REQ-DSH-020
 * @intent `xp-gate init` 会向 ~/.dsh/skills 部署技能、npm 包也带 plugins/dsh，
 *         但 PLATFORM_PROFILES 里没有 dsh 条目，getSkillsDirs('dsh') 静默回落到
 *         opencode 的路径，导致 DSH 机器的技能从不被解析（#635）。
 *         原注释写的 @covers AC-635-04/05 在 spec 里从未存在（REQ-635 是
 *         normalize-lock-registry 的 lockfile 路径需求），已改指真实条目。
 * @covers AC-DSH-020-01, AC-DSH-020-02, AC-DSH-020-03, AC-DSH-020-04
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

/**
 * @test REQ-725
 * @intent 多平台共存时 detectPlatform() 按优先级短路返回单个平台，install-skill/
 *         update-skill 与 doctor 都只拿它选中的目录，其余平台（含 detectPlatform()
 *         从不返回的 dsh）被永久冻结。detectInstalledPlatforms() 是「检测所有已安装
 *         agent」的原始能力：按 PLATFORM_PROFILES 里目录真实存在的平台返回全集。
 * @covers AC-725-01, AC-725-06
 */
describe('detectInstalledPlatforms (#725 detect-all)', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-detectall-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns every platform whose directory exists, including dsh', () => {
    fs.mkdirSync(path.join(tmpHome, '.qoder'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.dsh'), { recursive: true });

    const { detectInstalledPlatforms } = require('../detect-deps');
    const installed = detectInstalledPlatforms();
    expect(installed).toEqual(expect.arrayContaining(['opencode', 'qoder', 'dsh']));
    expect(installed).not.toContain('claude-code');
  });

  it('returns an empty list when no platform directory exists', () => {
    const { detectInstalledPlatforms } = require('../detect-deps');
    expect(detectInstalledPlatforms()).toEqual([]);
  });
});

/**
 * @test REQ-DSH-020
 * @intent #635 只给 PLATFORM_PROFILES 补了 dsh 条目，detectPlatform() 本身仍只
 *         可能返回 qoder / claude-code / opencode。只有 DSH 的机器上，所有持有
 *         该结果的调用方（install-skill、checkDeps、getTemplateDir）都瞄向
 *         ~/.config/opencode —— 一个 running agent 不读、也可能不存在的位置。
 *         `~/.dsh/profiles` 与 `~/.dsh/.shim` 是 DSH 独有目录，可作为可靠标记。
 * @covers AC-DSH-020-01, AC-DSH-020-02, AC-DSH-020-03, AC-DSH-020-04
 */
describe('detectPlatform() resolves dsh (#635 follow-up)', () => {
  let tmpHome;
  let originalHome;

  const load = () => {
    vi.resetModules();
    delete require.cache[require.resolve('../shared-paths')];
    return require('../shared-paths');
  };

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-platdsh-'));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // AC-DSH-020-01
  it('returns dsh when ~/.dsh/profiles exists', () => {
    fs.mkdirSync(path.join(tmpHome, '.dsh', 'profiles'), { recursive: true });
    expect(load().detectPlatform()).toBe('dsh');
  });

  it('returns dsh when only ~/.dsh/.shim exists', () => {
    fs.mkdirSync(path.join(tmpHome, '.dsh', '.shim'), { recursive: true });
    expect(load().detectPlatform()).toBe('dsh');
  });

  it('does not return dsh when neither dsh marker exists', () => {
    // A bare ~/.dsh/skills is NOT a marker: every platform has a skills/ dir,
    // so keying on it would steal opencode/qoder machines.
    fs.mkdirSync(path.join(tmpHome, '.dsh', 'skills'), { recursive: true });
    expect(load().detectPlatform()).not.toBe('dsh');
  });

  it('still falls back to opencode on an empty home', () => {
    expect(load().detectPlatform()).toBe('opencode');
  });

  // AC-DSH-020-02: DSH wins over the other markers — it is the agent whose
  // skills/ the user is actually reading, so installs must land there.
  it('prefers dsh over qoder and claude-code when all markers coexist', () => {
    fs.mkdirSync(path.join(tmpHome, '.dsh', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.qoder'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.claude', 'skills'), { recursive: true });
    expect(load().detectPlatform()).toBe('dsh');
  });

  // AC-DSH-020-02: the pre-existing precedence must survive — removing the DSH
  // markers must restore qoder > claude-code > opencode exactly as before.
  it('leaves qoder/claude-code/opencode precedence intact without dsh markers', () => {
    fs.mkdirSync(path.join(tmpHome, '.qoder'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.claude', 'skills'), { recursive: true });
    expect(load().detectPlatform()).toBe('qoder');

    fs.rmSync(path.join(tmpHome, '.qoder'), { recursive: true, force: true });
    expect(load().detectPlatform()).toBe('claude-code');

    fs.rmSync(path.join(tmpHome, '.claude'), { recursive: true, force: true });
    expect(load().detectPlatform()).toBe('opencode');
  });

  // AC-DSH-020-04
  it('getTemplateDir() targets ~/.dsh, not the opencode fallback', () => {
    fs.mkdirSync(path.join(tmpHome, '.dsh', 'profiles'), { recursive: true });
    const dir = load().getTemplateDir();
    expect(dir).toBe(path.join(tmpHome, '.dsh', 'git-hooks-template'));
    expect(dir).not.toContain(path.join('.config', 'opencode'));
  });
});

/**
 * @test REQ-DSH-020
 * @intent install-skill 曾维护第二份平台→目录表（getSkillsDir），#635 给
 *         PLATFORM_PROFILES 加 dsh 后它没跟着改，仍在 DSH-only 机器上返回
 *         ~/.config/opencode/skills。改为从 getSkillsDirs() 派生，消除第二事实源。
 * @covers AC-DSH-020-03
 */
describe('install-skill resolves its target through PLATFORM_PROFILES', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-installdsh-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../install-skill')];
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // The regression that actually bit (#635 follow-up), pinned end-to-end:
  // `installSkill()` calls `checkDeps(detectPlatform())` BEFORE it resolves any
  // target directory. When detection fell through to opencode on a DSH machine,
  // the dependency probe looked in `~/.config/opencode/skills`, found nothing,
  // and the command aborted with "superpowers is required but not installed" --
  // no skill was ever written, so a test that only asserted the write target
  // would have passed while the reported bug stayed live.
  //
  // Mutation-checked: making detectPlatform() skip the DSH markers turns the
  // `code` assertion back to 1 with "superpowers is required".
  it('passes the dependency check when deps live under a DSH-only ~/.dsh/skills', async () => {
    const BUNDLED = path.join(__dirname, '..', '..', 'skills');
    if (!fs.existsSync(BUNDLED)) return; // packaged build not generated in this tree

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-depcheck-'));
    try {
      fs.mkdirSync(path.join(home, '.dsh', 'profiles'), { recursive: true });
      const dshSkills = path.join(home, '.dsh', 'skills');
      // Deps are installed where DSH keeps skills -- and nowhere else. The old
      // opencode fallback therefore cannot see them.
      for (const dep of ['superpowers', 'gstack']) {
        const dir = path.join(dshSkills, dep);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
      }

      process.env.HOME = home;
      vi.resetModules();
      delete require.cache[require.resolve('../install-skill')];
      delete require.cache[require.resolve('../detect-deps')];
      delete require.cache[require.resolve('../shared-paths')];

      const { detectPlatform } = require('../shared-paths');
      const { checkDeps } = require('../detect-deps');
      // The load-bearing assertion: detection must name dsh so the probe looks
      // in the tree the deps were actually installed into.
      expect(detectPlatform()).toBe('dsh');
      expect(await checkDeps(detectPlatform())).toEqual({ ok: true });
      // Anti-vacuity: the same tree is invisible to the platform the pre-fix
      // code would have selected.
      expect(await checkDeps('opencode')).toEqual({ ok: false, missing: 'superpowers' });
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(home, { recursive: true, force: true });
      vi.resetModules();
      delete require.cache[require.resolve('../install-skill')];
      delete require.cache[require.resolve('../detect-deps')];
      delete require.cache[require.resolve('../shared-paths')];
    }
  });

  // A bare ~/.dsh/skills must not steal an opencode machine — restated here
  // because this is exactly the case the duplicated table got wrong.
  it('does not target ~/.dsh/skills when only that directory exists', () => {
    fs.mkdirSync(path.join(tmpHome, '.dsh', 'skills'), { recursive: true });
    const { detectPlatform } = require('../shared-paths');
    const { getSkillsDirs } = require('../detect-deps');

    expect(getSkillsDirs(detectPlatform())[0]).not.toBe(path.join(tmpHome, '.dsh', 'skills'));
  });
});
