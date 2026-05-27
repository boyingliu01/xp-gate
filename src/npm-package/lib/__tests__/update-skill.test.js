/**
 * @test update-skill
 * @intent Verify updateSkill() handles check/all/single-name modes, config parsing, and delegates to installSkill correctly
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('update-skill', () => {
  let tmpHome;
  let originalHome;
  let logSpy;
  let errorSpy;
  let installSkillMock;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-up-'));
    process.env.HOME = tmpHome;

    vi.resetModules();
    delete require.cache[require.resolve('../update-skill')];
    delete require.cache[require.resolve('../install-skill.js')];

    // Inject mock install-skill module into the require.cache BEFORE update-skill
    // pulls it in (it lazy-requires it inside updateSingleSkill).
    installSkillMock = vi.fn().mockResolvedValue(0);
    const installSkillPath = require.resolve('../install-skill.js');
    require.cache[installSkillPath] = {
      id: installSkillPath,
      filename: installSkillPath,
      loaded: true,
      exports: { installSkill: installSkillMock },
    };

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete require.cache[require.resolve('../install-skill.js')];
    delete require.cache[require.resolve('../update-skill')];
    vi.restoreAllMocks();
  });

  function configDir() {
    return path.join(tmpHome, '.config', 'xp-gate');
  }

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function writeConfig(skills) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(
      path.join(configDir(), 'xp-gate.json'),
      JSON.stringify({ installedSkills: skills })
    );
  }

  function makeSkillDir(name) {
    const dir = path.join(skillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'old content');
    return dir;
  }

  // ----- name + flags validation -----

  it('returns 1 + console.error when name is null and no flags', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null);
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Skill name required');
    expect(errorSpy).toHaveBeenCalledWith(
      'Usage: xp-gate update-skill <name> or --all'
    );
  });

  it('returns 1 + console.error when name is undefined and no flags', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill();
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Skill name required');
  });

  it('returns 1 + "is not installed" when name not in config.installedSkills', async () => {
    writeConfig({}); // empty
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  it('returns 1 + "is not installed" when config file is missing entirely', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  // ----- check mode -----

  it('check=true prints each installed skill with its version, returns 0', async () => {
    writeConfig({
      foo: { version: '1.2.3' },
      bar: { version: '2.0.0' },
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Checking for updates...');
    expect(logSpy).toHaveBeenCalledWith('  foo: 1.2.3');
    expect(logSpy).toHaveBeenCalledWith('  bar: 2.0.0');
    expect(logSpy).toHaveBeenCalledWith('Update check complete');
  });

  it('check=true with skill missing version falls back to "unknown"', async () => {
    writeConfig({ baz: {} }); // no version field
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('  baz: unknown');
  });

  it('check=true with empty config returns 0 and prints only headers', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Checking for updates...');
    expect(logSpy).toHaveBeenCalledWith('Update check complete');
  });

  // ----- all mode -----

  it('all=true with empty skills returns 0 and prints "Updating all skills..."', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Updating all skills...');
    expect(installSkillMock).not.toHaveBeenCalled();
  });

  it('all=true updates every installed skill (calls installSkill each), returns 0 on success', async () => {
    writeConfig({
      foo: { version: '1.0.0' },
      bar: { version: '1.0.0' },
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledTimes(2);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: false,
    });
    expect(installSkillMock).toHaveBeenCalledWith('bar', {
      force: true,
      verbose: false,
    });
    expect(logSpy).toHaveBeenCalledWith('Updating foo...');
    expect(logSpy).toHaveBeenCalledWith('Updating bar...');
    expect(logSpy).toHaveBeenCalledWith('✓ foo updated');
    expect(logSpy).toHaveBeenCalledWith('✓ bar updated');
  });

  it('all=true returns 1 when at least one installSkill rejects', async () => {
    writeConfig({
      good: { version: '1.0.0' },
      bad: { version: '1.0.0' },
    });
    installSkillMock.mockImplementation(async (name) => {
      if (name === 'bad') throw new Error('boom');
      return 0;
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Failed to update bad: boom');
    expect(logSpy).toHaveBeenCalledWith('✓ good updated');
  });

  it('all=true propagates verbose flag into installSkill options', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true, verbose: true });
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: true,
    });
  });

  // ----- single skill mode -----

  it('updateSkill(name) calls installSkill and returns its result (0=success)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: false,
    });
    expect(logSpy).toHaveBeenCalledWith('Updating foo...');
    expect(logSpy).toHaveBeenCalledWith('✓ foo updated');
  });

  it('updateSkill(name) returns installSkill result when non-zero (no success log)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    installSkillMock.mockResolvedValue(2);
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(2);
    expect(logSpy).not.toHaveBeenCalledWith('✓ foo updated');
  });

  it('removes existing targetDir before invoking installSkill', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const dir = makeSkillDir('foo');
    expect(fs.existsSync(dir)).toBe(true);

    let dirExistedDuringInstall = true;
    installSkillMock.mockImplementation(async () => {
      dirExistedDuringInstall = fs.existsSync(dir);
      return 0;
    });

    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(dirExistedDuringInstall).toBe(false); // rm'd before installSkill called
  });

  it('does not crash when targetDir does not exist', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    // No skill dir on disk
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalled();
  });

  // ----- getConfig fallback paths -----

  it('getConfig returns {} when config file does not exist (single-name path → not installed)', async () => {
    // exercised via "is not installed" — config absent ⇒ installedSkills undefined ⇒ {}
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('anything');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: anything is not installed');
  });

  it('getConfig returns {} on JSON parse error (catch swallows)', async () => {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(path.join(configDir(), 'xp-gate.json'), '{not valid json');
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  it('getConfig parses valid config (single-name path succeeds)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: false,
    });
  });
});
