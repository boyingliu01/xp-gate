/**
 * @test install-skill
 * @intent Verify installSkill() handles deps check, registry lookup, download, config, and errors
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');

function mockHttpsGet(optsOrList) {
  const list = Array.isArray(optsOrList) ? [...optsOrList] : [optsOrList];
  // Synchronous fake createWriteStream — the real one opens the FD asynchronously
  // and races against downloadFile's unlinkSync(dest) in 301/302/error branches,
  // causing ENOENT unhandled errors.
  vi.spyOn(fs, 'createWriteStream').mockImplementation((dest) => {
    let buf = '';
    try {
      fs.writeFileSync(dest, '');
    } catch {
      /* dest dir may not exist; downstream code will surface that */
    }
    const stream = new EventEmitter();
    stream.write = (chunk) => {
      buf += chunk;
      return true;
    };
    stream.end = () => {
      try {
        fs.writeFileSync(dest, buf);
      } catch {
        /* file may have been unlinked by source; safe to ignore */
      }
      process.nextTick(() => stream.emit('finish'));
    };
    stream.close = () => {};
    return stream;
  });

  vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    const req = new EventEmitter();
    const config = list.shift() || { statusCode: 200, body: '# Skill' };
    process.nextTick(() => {
      if (config.errorAfter) {
        req.emit('error', new Error('Network error'));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = config.statusCode != null ? config.statusCode : 200;
      response.headers = config.redirectTo ? { location: config.redirectTo } : {};
      response.pipe = (file) => {
        file.write(config.body != null ? config.body : '# Skill');
        file.end();
      };
      callback(response);
    });
    return req;
  });
}

describe('install-skill', () => {
  let tmpHome, originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-in-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../install-skill')];
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../download-skill')];
    delete require.cache[require.resolve('../rollback')];
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

  it('returns 1 + Unknown skill error for unregistered name', async () => {
    setupValidDeps();
    const { installSkill } = require('../install-skill');
    const result = await installSkill('not-a-real-skill');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown skill: not-a-real-skill');
  });

  it('returns 0 and writes SKILL.md when install succeeds', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# Sprint Flow\nskill content' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(0);
    const installedFile = path.join(skillsDir(), 'sprint-flow', 'SKILL.md');
    expect(fs.existsSync(installedFile)).toBe(true);
    expect(fs.readFileSync(installedFile, 'utf8')).toContain('Sprint Flow');
    expect(console.log).toHaveBeenCalledWith('✓ sprint-flow installed');
  });

  it('updates config with installedSkills metadata after successful install', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# Content' });

    const { installSkill } = require('../install-skill');
    await installSkill('delphi-review');

    const configFile = path.join(configDir(), 'xp-gate.json');
    expect(fs.existsSync(configFile)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(config.installedSkills).toHaveProperty('delphi-review');
    expect(config.installedSkills['delphi-review'].version).toBe('1.0.0');
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
    expect(console.error).toHaveBeenCalledWith('Error: sprint-flow is already installed');
  });

  it('backs up and replaces when target exists and force=true', async () => {
    setupValidDeps();
    const target = path.join(skillsDir(), 'sprint-flow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'OLD.md'), 'old-content');
    mockHttpsGet({ statusCode: 200, body: '# New Content' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { force: true });

    expect(result).toBe(0);
    const skillMd = path.join(target, 'SKILL.md');
    expect(fs.existsSync(skillMd)).toBe(true);
    expect(fs.readFileSync(skillMd, 'utf8')).toContain('New Content');

    const backupRoot = path.join(configDir(), 'backup');
    expect(fs.existsSync(backupRoot)).toBe(true);
    const backups = fs.readdirSync(backupRoot);
    expect(backups.length).toBeGreaterThan(0);
    const backedUpFile = path.join(backupRoot, backups[0], 'OLD.md');
    expect(fs.existsSync(backedUpFile)).toBe(true);
    expect(fs.readFileSync(backedUpFile, 'utf8')).toBe('old-content');
  });

  it('returns 1 + Failed to download when network fails (non-offline)', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 404 });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Failed to download sprint-flow');
  });

  it('returns 2 + offline-cache error when offline=true and no cache', async () => {
    setupValidDeps();

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { offline: true });

    expect(result).toBe(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--offline specified but sprint-flow not in cache')
    );
  });

  it('verbose=true prints Downloading and Installed-to logs', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# X' });

    const { installSkill } = require('../install-skill');
    await installSkill('test-spec', { verbose: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Downloading '));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Installed to '));
  });

  it('verbose=true prints download-failure warning when network errors', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 500 });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('ralph-loop', { verbose: true });

    expect(result).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Download failed'));
  });

  it('follows redirect (302) to download successfully', async () => {
    setupValidDeps();
    mockHttpsGet([
      { statusCode: 302, redirectTo: 'https://new.example.com/skill.md' },
      { statusCode: 200, body: '# Redirected Content' },
    ]);

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(0);
    const installedFile = path.join(skillsDir(), 'sprint-flow', 'SKILL.md');
    expect(fs.readFileSync(installedFile, 'utf8')).toContain('Redirected Content');
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
    mockHttpsGet({ statusCode: 200, body: '# X' });

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
    mockHttpsGet({ statusCode: 200, body: '# X' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(0);
  });

  it('returns 1 + Failed to download on network error (non-verbose silent)', async () => {
    setupValidDeps();
    mockHttpsGet({ errorAfter: true });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('test-spec');

    expect(result).toBe(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Error: Failed to download test-spec');
  });
});
