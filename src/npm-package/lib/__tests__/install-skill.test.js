/**
 * @test install-skill
 * @intent Verify installSkill() handles deps check, bundle lookup, config, backup, and errors
 * @covers AC-416-01, AC-416-05
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const BUNDLED_SKILLS = path.join(__dirname, '..', '..', 'skills');

function listDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Shared fixture for the blocks that need a throwaway HOME and a clean module
 * cache.
 *
 * install-skill reads caches HOME at module load, so every test has to reset
 * four modules and silence three console channels. Two copies of that boilerplate
 * tripped the clone detector, and the two copies had already drifted (one
 * afterEach waited for a pending setImmediate, the other did not) -- which is
 * exactly how a teardown race starts. The stricter teardown wins here.
 */
function makeHomeFixture(prefix) {
  const handle = { tmpHome: null, originalHome: null };
  const MODULES = ['../install-skill', '../detect-deps', '../shared-paths', '../rollback'];

  handle.dropModuleCache = () => {
    for (const mod of MODULES) delete require.cache[require.resolve(mod)];
  };

  handle.beforeEach = () => {
    handle.originalHome = process.env.HOME;
    handle.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.HOME = handle.tmpHome;
    vi.resetModules();
    handle.dropModuleCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };

  handle.afterEach = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    process.env.HOME = handle.originalHome;
    vi.restoreAllMocks();
    if (fs.existsSync(handle.tmpHome)) {
      fs.rmSync(handle.tmpHome, { recursive: true, force: true });
    }
    handle.dropModuleCache();
  };

  return handle;
}

describe('install-skill', () => {
  const fx = makeHomeFixture('xpgate-in-');

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  function skillsDir() {
    return path.join(fx.tmpHome, '.config', 'opencode', 'skills');
  }

  function configDir() {
    return path.join(fx.tmpHome, '.config', 'xp-gate');
  }

  function setupValidDeps() {
    ['superpowers', 'gstack'].forEach((name) => {
      const dir = path.join(skillsDir(), name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '2.0.0' })
      );
    });
  }

  it('returns 1 + error when superpowers dep is missing', async () => {
    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('superpowers is required')
    );
  });

  it('returns 1 + error when gstack dep is missing (superpowers present)', async () => {
    const dir = path.join(skillsDir(), 'superpowers');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('gstack is required')
    );
  });

  it('returns 1 + error when dep version is too old (versionMismatch branch)', async () => {
    ['superpowers', 'gstack'].forEach((name) => {
      const dir = path.join(skillsDir(), name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '0.5.0' })
      );
    });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('version too old')
    );
  });

  it('returns 1 + Unknown skill error for a name the bundle does not carry', async () => {
    setupValidDeps();
    const { installSkill } = require('../install-skill');
    const result = await installSkill('not-a-real-skill');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown skill: not-a-real-skill');
  });

  // The old hand-maintained SKILLS_REGISTRY could list a skill the bundle did not
  // ship (or miss one it did). The error hint must come from the bundle itself.
  it('names exactly the bundled skills in the unknown-skill hint', async () => {
    setupValidDeps();
    const { installSkill } = require('../install-skill');
    await installSkill('not-a-real-skill');

    const hint = console.error.mock.calls
      .map(([message]) => message)
      .find((message) => typeof message === 'string' && message.includes('bundles:'));
    expect(hint).toBeDefined();
    expect(hint.match(/bundles: ([^.]*)\./)[1].split(', ').sort()).toEqual(listDirs(BUNDLED_SKILLS));
  });

  it('keeps an existing directory when the skill is not bundled', async () => {
    // Validation must precede backupExisting(), which rmSyncs the target: a
    // leftover skill from an older package must never be wiped by a failed install.
    setupValidDeps();
    const target = path.join(skillsDir(), 'removed-in-this-version');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'keep me');

    const { installSkill } = require('../install-skill');
    const result = await installSkill('removed-in-this-version');

    expect(result).toBe(1);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('keep me');
  });

  it('returns 0 and installs the bundled skill when install succeeds', async () => {
    setupValidDeps();

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(0);
    const installedFile = path.join(skillsDir(), 'sprint-flow', 'SKILL.md');
    expect(fs.readFileSync(installedFile, 'utf8'))
      .toBe(fs.readFileSync(path.join(BUNDLED_SKILLS, 'sprint-flow', 'SKILL.md'), 'utf8'));
    expect(console.log).toHaveBeenCalledWith('✓ sprint-flow installed');
  });

  it('updates config with installedSkills metadata after successful install', async () => {
    setupValidDeps();

    const { installSkill } = require('../install-skill');
    await installSkill('delphi-review');

    const configFile = path.join(configDir(), 'xp-gate.json');
    expect(fs.existsSync(configFile)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(config.installedSkills).toHaveProperty('delphi-review');
    // Read the version dynamically so a bump never breaks this test. The source
    // is package.json, not the repo's VERSION: that file is a release stamp
    // ('0.35.23.0'), is not shipped in the npm package, and resolving it from
    // __dirname only works inside a checkout (#713).
    const expectedVersion = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    ).version;
    expect(config.installedSkills['delphi-review'].version).toBe(expectedVersion);
    expect(config.installedSkills['delphi-review'].installedAt).toMatch(/^\d{4}-/);
  });

  it('returns 1 + already-installed error when target exists and force=false', async () => {
    setupValidDeps();
    const target = path.join(skillsDir(), 'sprint-flow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'existing');

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: sprint-flow is already installed\nUse --force to overwrite');
  });

  it('backs up and replaces when target exists and force=true', async () => {
    setupValidDeps();
    const target = path.join(skillsDir(), 'sprint-flow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'OLD.md'), 'old-content');

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { force: true });

    expect(result).toBe(0);
    const skillMd = path.join(target, 'SKILL.md');
    expect(fs.readFileSync(skillMd, 'utf8'))
      .toBe(fs.readFileSync(path.join(BUNDLED_SKILLS, 'sprint-flow', 'SKILL.md'), 'utf8'));
    expect(fs.existsSync(path.join(target, 'OLD.md'))).toBe(false);

    const backupRoot = path.join(configDir(), 'backup');
    expect(fs.existsSync(backupRoot)).toBe(true);
    const backups = fs.readdirSync(backupRoot);
    expect(backups.length).toBeGreaterThan(0);
    const backedUpFile = path.join(backupRoot, backups[0], 'OLD.md');
    expect(fs.existsSync(backedUpFile)).toBe(true);
    expect(fs.readFileSync(backedUpFile, 'utf8')).toBe('old-content');
  });

  it('verbose=true prints Installing and Installed-to logs', async () => {
    setupValidDeps();

    const { installSkill } = require('../install-skill');
    await installSkill('test-driven-development', { verbose: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Installing '));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Installed to '));
  });

  it('merges new skill into existing installedSkills config', async () => {
    setupValidDeps();
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(
      path.join(configDir(), 'xp-gate.json'),
      JSON.stringify({
        installedSkills: { 'other-skill': { version: '0.1.0' } },
        otherSetting: true,
      })
    );

    const { installSkill } = require('../install-skill');
    await installSkill('delphi-review');

    const config = JSON.parse(
      fs.readFileSync(path.join(configDir(), 'xp-gate.json'), 'utf8')
    );
    expect(config.installedSkills).toHaveProperty('other-skill');
    expect(config.installedSkills).toHaveProperty('delphi-review');
    expect(config.otherSetting).toBe(true);
  });

  it('handles malformed config JSON during update (catch returns {})', async () => {
    setupValidDeps();
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(path.join(configDir(), 'xp-gate.json'), '{not-valid-json');

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(0);
  });
});

// ── #713: the "unknown skill" hint must not print a fake version ─────────────
// getCliVersion() resolved `../../../VERSION` relative to __dirname. In an
// installed package __dirname is
// `node_modules/@boyingliu01/xp-gate/lib`, so three levels up lands in
// `node_modules/` -- and the package does not ship a VERSION file at all. The
// catch therefore fed `0.0.0` to every caller that prints it, so a user seeing
//
//   xp-gate 0.0.0 bundles: ...
//
// reasonably concluded their install was broken. The version has to come from
// the package.json the CLI is actually running out of.
describe('install-skill #713 CLI version reporting', () => {
  const fx = makeHomeFixture('xpgate-ver-');

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  /**
   * @test REQ-713 Honest version reporting
   * @intent An unknown-skill error must name the real package version, never 0.0.0
   * @covers AC-713-04
   *
   * The repo checkout masks this bug: `<repo>/VERSION` exists, so resolving
   * `../../../VERSION` from `src/npm-package/lib/` lands on it and looks correct.
   * An installed package has no such luck -- npm's `files` list does not include
   * VERSION, and three levels up from `node_modules/@boyingliu01/xp-gate/lib` is
   * `node_modules/`. So the assertion that matters is the one that holds in the
   * shipped layout, which is measured here by demanding the value AGREE with
   * package.json rather than with whatever VERSION happens to sit above the tree.
   */
  it('AC-713-04: unknown-skill error reports the package version, not 0.0.0 and not repo VERSION', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

    // install-skill destructures checkDeps at require time, so a spy on the
    // module object cannot intercept it. Inject a stub into the require cache
    // BEFORE install-skill loads -- the deps gate runs ahead of the name check,
    // and this test measures version reporting, not dependency probing.
    const detectPath = require.resolve('../detect-deps.js');
    require.cache[detectPath] = {
      id: detectPath,
      filename: detectPath,
      loaded: true,
      exports: {
        ...require('../detect-deps.js'),
        checkDeps: async () => ({ ok: true }),
      },
    };

    const { installSkill } = require('../install-skill');
    const code = await installSkill('definitely-not-a-bundled-skill', { force: true });
    expect(code).toBe(1);

    const said = console.error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(said).toMatch(/Unknown skill/);
    expect(said).not.toContain('0.0.0');
    expect(said).toContain(`xp-gate ${pkg.version} bundles:`);
  });
});
