/**
 * @test uninstall-skill
 * @intent Verify uninstallSkill() correctly removes skills, cleans cache, and updates config
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('uninstall-skill', () => {
  let tmpHome;
  let originalHome;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-un-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../uninstall-skill')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function configDir() {
    return path.join(tmpHome, '.config', 'xp-gate');
  }

  function cacheDir() {
    return path.join(configDir(), 'cache');
  }

  function makeInstalledSkill(name) {
    const dir = path.join(skillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'content');
    return dir;
  }

  it('returns 1 + console.error when name is empty', async () => {
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill();
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Skill name required');
    expect(errorSpy).toHaveBeenCalledWith('Usage: xp-gate uninstall-skill <name> [--force]');
  });

  it('returns 1 + console.error when name is empty string', async () => {
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns 1 when skill is not installed', async () => {
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('not-installed');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: not-installed is not installed');
  });

  it('returns 0 and prompts (no deletion) when force=false', async () => {
    const dir = makeInstalledSkill('foo');
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo');
    expect(result).toBe(0);
    expect(fs.existsSync(dir)).toBe(true); // NOT deleted
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Uninstall foo?'));
    expect(logSpy).toHaveBeenCalledWith('Use --force to skip confirmation');
  });

  it('returns 0 and removes skill dir when force=true', async () => {
    const dir = makeInstalledSkill('foo');
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('Removing foo...');
    expect(logSpy).toHaveBeenCalledWith('✓ foo uninstalled');
  });

  it('removes cache file (foo.tgz) when force=true', async () => {
    makeInstalledSkill('foo');
    fs.mkdirSync(cacheDir(), { recursive: true });
    const cacheFile = path.join(cacheDir(), 'foo.tgz');
    fs.writeFileSync(cacheFile, 'cached-tgz-data');

    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it('does not error when no cache file exists', async () => {
    makeInstalledSkill('foo');
    // No cache dir created
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);
  });

  it('removes skill entry from installedSkills in config when force=true', async () => {
    makeInstalledSkill('foo');
    fs.mkdirSync(configDir(), { recursive: true });
    const configFile = path.join(configDir(), 'xp-gate.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        installedSkills: { foo: { version: '1.0.0' }, bar: { version: '2.0.0' } },
        otherSetting: true,
      })
    );

    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);

    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(written.installedSkills).not.toHaveProperty('foo');
    expect(written.installedSkills).toHaveProperty('bar');
    expect(written.otherSetting).toBe(true);
  });

  it('does not write config when no installedSkills key present', async () => {
    makeInstalledSkill('foo');
    fs.mkdirSync(configDir(), { recursive: true });
    const configFile = path.join(configDir(), 'xp-gate.json');
    fs.writeFileSync(configFile, JSON.stringify({ otherSetting: 'unchanged' }));

    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);

    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(written.otherSetting).toBe('unchanged');
    expect(written).not.toHaveProperty('installedSkills');
  });

  it('handles missing config file gracefully (getConfig returns {})', async () => {
    makeInstalledSkill('foo');
    // No config file
    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);
    // No config file should be created (since config = {} has no installedSkills)
    expect(fs.existsSync(path.join(configDir(), 'xp-gate.json'))).toBe(false);
  });

  it('handles malformed config JSON gracefully (catch swallows + returns {})', async () => {
    makeInstalledSkill('foo');
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(path.join(configDir(), 'xp-gate.json'), '{invalid json');

    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('foo', { force: true });
    expect(result).toBe(0);
  });

  it('removes cache file + skill dir + config entry in one call (full path)', async () => {
    const dir = makeInstalledSkill('full');
    fs.mkdirSync(cacheDir(), { recursive: true });
    const cacheFile = path.join(cacheDir(), 'full.tgz');
    fs.writeFileSync(cacheFile, 'data');
    const configFile = path.join(configDir(), 'xp-gate.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ installedSkills: { full: { version: '1.0.0' } } })
    );

    const { uninstallSkill } = require('../uninstall-skill');
    const result = await uninstallSkill('full', { force: true });

    expect(result).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(cacheFile)).toBe(false);
    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(written.installedSkills).not.toHaveProperty('full');
  });
});
