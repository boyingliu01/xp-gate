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

describe('install-skill', () => {
  let tmpHome, originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-in-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    for (const mod of ['../install-skill', '../detect-deps', '../shared-paths', '../rollback']) {
      delete require.cache[require.resolve(mod)];
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    if (fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function configDir() {
    return path.join(tmpHome, '.config', 'xp-gate');
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
    // Read version dynamically from VERSION file — no hardcoded version to break on bump
    const expectedVersion = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'VERSION'), 'utf8').trim();
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
