/**
 * @test detect-deps
 * @intent Verify checkDeps() correctly detects missing/present/outdated dependencies across platforms,
 *         detectPlatform() identifies the correct AI agent platform,
 *         and autoInstallDeps() handles install scenarios
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('detect-deps', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-detect-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeSkillDir(skillName, contents = {}, baseDir) {
    const dir = baseDir
      ? path.join(baseDir, skillName)
      : path.join(tmpHome, '.config', 'opencode', 'skills', skillName);
    fs.mkdirSync(dir, { recursive: true });
    if (contents.packageJson) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents.packageJson));
    }
    if (contents.skillMd) {
      fs.writeFileSync(path.join(dir, 'SKILL.md'), contents.skillMd);
    }
    return dir;
  }

  function makeOpencodeDir(skillName, contents = {}) {
    const dir = path.join(tmpHome, '.config', 'opencode', skillName);
    fs.mkdirSync(dir, { recursive: true });
    if (contents.packageJson) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents.packageJson));
    }
    if (contents.skillMd) {
      fs.writeFileSync(path.join(dir, 'SKILL.md'), contents.skillMd);
    }
    return dir;
  }

  // ── checkDeps: backward-compatible tests (default platform = opencode) ──

  it('returns ok:false missing:superpowers when no deps exist', async () => {
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('superpowers');
  });

  it('returns ok:false missing:gstack when superpowers exists but gstack missing', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('gstack');
  });

  it('returns ok:true when both deps exist via package.json with adequate version', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.5.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true when deps exist in fallback OPENCODE_DIR path', async () => {
    makeOpencodeDir('superpowers', { packageJson: { version: '1.0.0' } });
    makeOpencodeDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true when version read from SKILL.md frontmatter', async () => {
    makeSkillDir('superpowers', { skillMd: 'version: "2.1.0"\n---\nSkill content' });
    makeSkillDir('gstack', { skillMd: 'version: "1.2.3"\n---\nSkill content' });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('reads version from SKILL.md without quotes', async () => {
    makeSkillDir('superpowers', { skillMd: 'version: 2.1.0\n' });
    makeSkillDir('gstack', { skillMd: 'version: 1.0.0\n' });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns versionMismatch when superpowers version < minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '0.0.1' } });
    makeSkillDir('gstack', { packageJson: { version: '2.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch).toEqual({
      name: 'superpowers',
      required: '1.0.0',
      found: '0.0.1',
    });
  });

  it('returns versionMismatch when gstack version < minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '0.5.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.name).toBe('gstack');
    expect(result.versionMismatch.found).toBe('0.5.0');
  });

  it('passes when version is exactly equal to minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '1.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true (no version check) when package.json has no version and no SKILL.md', async () => {
    makeSkillDir('superpowers', { packageJson: {} });
    makeSkillDir('gstack', { packageJson: {} });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('handles malformed package.json gracefully (falls through to SKILL.md or null)', async () => {
    const supDir = path.join(tmpHome, '.config', 'opencode', 'skills', 'superpowers');
    fs.mkdirSync(supDir, { recursive: true });
    fs.writeFileSync(path.join(supDir, 'package.json'), '{invalid json');
    fs.writeFileSync(path.join(supDir, 'SKILL.md'), 'version: "2.0.0"\n');
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns null version when neither package.json nor SKILL.md exist (skips version check)', async () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode', 'skills', 'superpowers'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode', 'skills', 'gstack'), { recursive: true });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns null when SKILL.md exists but has no version line', async () => {
    makeSkillDir('superpowers', { skillMd: 'no version here\n' });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('compareVersions handles partial versions (e.g. 1 treated as 1.0.0)', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '1' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('compareVersions: greater version passes', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '10.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '5.5.5' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('compareVersions: minor version less fails', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '0.9.99' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.found).toBe('0.9.99');
  });

  it('prefers SKILLS_DIR over OPENCODE_DIR when both exist', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '0.0.1' } });
    makeOpencodeDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.found).toBe('0.0.1');
  });

  // ── Platform-specific tests (Issue #128) ──

  describe('checkDeps with platform parameter', () => {
    it('qoder: checks ~/.qoder/skills/ for dependencies', async () => {
      const qoderSkills = path.join(tmpHome, '.qoder', 'skills');
      makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } }, path.join(qoderSkills, 'superpowers'));
      makeSkillDir('gstack', { packageJson: { version: '1.0.0' } }, path.join(qoderSkills, 'gstack'));
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('qoder');
      expect(result.ok).toBe(true);
    });

    it('qoder: returns missing when qoder skills dir is empty', async () => {
      fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('qoder');
      expect(result.ok).toBe(false);
      expect(result.missing).toBe('superpowers');
    });

    it('claude-code: checks ~/.claude/skills/ for dependencies', async () => {
      const claudeSkills = path.join(tmpHome, '.claude', 'skills');
      makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } }, path.join(claudeSkills, 'superpowers'));
      makeSkillDir('gstack', { packageJson: { version: '1.0.0' } }, path.join(claudeSkills, 'gstack'));
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('claude-code');
      expect(result.ok).toBe(true);
    });

    it('claude-code: returns missing when claude skills dir is empty', async () => {
      fs.mkdirSync(path.join(tmpHome, '.claude', 'skills'), { recursive: true });
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('claude-code');
      expect(result.ok).toBe(false);
      expect(result.missing).toBe('superpowers');
    });

    it('unknown platform falls back to opencode profile', async () => {
      makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
      makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('unknown-platform');
      expect(result.ok).toBe(true);
    });

    it('qoder platform does NOT find deps in opencode dir', async () => {
      // Put deps in opencode dir but NOT in qoder dir
      makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
      makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
      const { checkDeps } = require('../detect-deps');
      const result = await checkDeps('qoder');
      expect(result.ok).toBe(false);
      expect(result.missing).toBe('superpowers');
    });
  });

  // ── detectPlatform tests ──

  describe('detectPlatform', () => {
    it('returns "qoder" when ~/.qoder/skills/ exists', () => {
      fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });
      const { detectPlatform } = require('../detect-deps');
      expect(detectPlatform()).toBe('qoder');
    });

    it('returns "claude-code" when ~/.claude/skills/ exists', () => {
      fs.mkdirSync(path.join(tmpHome, '.claude', 'skills'), { recursive: true });
      const { detectPlatform } = require('../detect-deps');
      expect(detectPlatform()).toBe('claude-code');
    });

    it('returns "opencode" as default when no platform dirs exist', () => {
      const { detectPlatform } = require('../detect-deps');
      expect(detectPlatform()).toBe('opencode');
    });

    it('prefers qoder over claude-code when both exist', () => {
      fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tmpHome, '.claude', 'skills'), { recursive: true });
      const { detectPlatform } = require('../detect-deps');
      expect(detectPlatform()).toBe('qoder');
    });
  });

  // ── getSkillsDirs tests ──

  describe('getSkillsDirs', () => {
    it('returns opencode paths for opencode platform', () => {
      const { getSkillsDirs } = require('../detect-deps');
      const dirs = getSkillsDirs('opencode');
      expect(dirs[0]).toContain('.config');
      expect(dirs[0]).toContain('opencode');
    });

    it('returns qoder paths for qoder platform', () => {
      const { getSkillsDirs } = require('../detect-deps');
      const dirs = getSkillsDirs('qoder');
      expect(dirs[0]).toContain('.qoder');
    });

    it('returns claude-code paths for claude-code platform', () => {
      const { getSkillsDirs } = require('../detect-deps');
      const dirs = getSkillsDirs('claude-code');
      expect(dirs[0]).toContain('.claude');
    });
  });

  // ── PLATFORM_PROFILES tests ──

  describe('PLATFORM_PROFILES', () => {
    it('all platforms have requiredDeps defined', () => {
      const { PLATFORM_PROFILES } = require('../detect-deps');
      expect(PLATFORM_PROFILES.opencode.requiredDeps.length).toBe(2);
      expect(PLATFORM_PROFILES.qoder.requiredDeps.length).toBe(2);
      expect(PLATFORM_PROFILES['claude-code'].requiredDeps.length).toBe(2);
    });

    it('all platforms have skillsDirs defined', () => {
      const { PLATFORM_PROFILES } = require('../detect-deps');
      expect(PLATFORM_PROFILES.opencode.skillsDirs.length).toBeGreaterThan(0);
      expect(PLATFORM_PROFILES.qoder.skillsDirs.length).toBeGreaterThan(0);
      expect(PLATFORM_PROFILES['claude-code'].skillsDirs.length).toBeGreaterThan(0);
    });
  });

  // ── autoInstallDeps tests ──

  describe('autoInstallDeps', () => {
    it('returns ok:true with empty installed when deps already exist', async () => {
      makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
      makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
      const { autoInstallDeps } = require('../detect-deps');
      const result = await autoInstallDeps();
      expect(result.ok).toBe(true);
      expect(result.installed).toEqual([]);
    });

    it('creates skills directory if it does not exist', async () => {
      const { autoInstallDeps } = require('../detect-deps');
      vi.spyOn(require('child_process'), 'spawnSync').mockImplementation((cmd, args) => {
        const destPath = args[args.length - 1];
        fs.mkdirSync(destPath, { recursive: true });
        fs.writeFileSync(path.join(destPath, 'package.json'), JSON.stringify({ version: '2.0.0' }));
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });

      const result = await autoInstallDeps();
      expect(result.ok).toBe(true);
      expect(result.installed).toContain('superpowers');
      expect(result.installed).toContain('gstack');

      vi.restoreAllMocks();
    });

    it('returns errors when git clone fails', async () => {
      const { autoInstallDeps } = require('../detect-deps');
      vi.spyOn(require('child_process'), 'spawnSync').mockImplementation(() => {
        throw new Error('git not found');
      });

      const result = await autoInstallDeps();
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('git not found');

      vi.restoreAllMocks();
    });

    it('returns errors when git clone exits non-zero (Issue #155)', async () => {
      const { autoInstallDeps } = require('../detect-deps');
      vi.spyOn(require('child_process'), 'spawnSync').mockImplementation(() => ({
        status: 128,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: repository not found'),
      }));

      const result = await autoInstallDeps();
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/repository not found|git clone failed|exit/i);

      vi.restoreAllMocks();
    });

    it('passes repoUrl as argv[] argument, never via shell string (Issue #155)', async () => {
      const { autoInstallDeps } = require('../detect-deps');
      const spy = vi.spyOn(require('child_process'), 'spawnSync').mockImplementation((cmd, args) => {
        const destPath = args[args.length - 1];
        fs.mkdirSync(destPath, { recursive: true });
        fs.writeFileSync(path.join(destPath, 'package.json'), JSON.stringify({ version: '2.0.0' }));
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });

      await autoInstallDeps();

      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) {
        const [cmd, args, opts] = call;
        expect(cmd).toBe('git');
        expect(Array.isArray(args)).toBe(true);
        expect(args[0]).toBe('clone');
        expect(opts && opts.shell).not.toBe(true);
      }

      vi.restoreAllMocks();
    });
  });

  // ── checkCliTool tests (Issue #299 — Windows cross-platform) ──

  describe('checkCliTool', () => {
    const { execSync: realExecSync } = require('child_process');

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns available:true when which finds the tool and --version succeeds', () => {
      vi.spyOn(require('child_process'), 'execSync')
        .mockReturnValueOnce('/usr/local/bin/jscpd\n')
        .mockReturnValueOnce('cpd 5.0.11\n');

      const { checkCliTool } = require('../detect-deps');
      const result = checkCliTool('jscpd');

      expect(result.available).toBe(true);
      expect(result.path).toBe('/usr/local/bin/jscpd');
      expect(result.version).toBe('cpd 5.0.11');
    });

    it('returns available:false when which and direct exec both fail', () => {
      vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });

      const { checkCliTool } = require('../detect-deps');
      const result = checkCliTool('nonexistent-tool');

      expect(result.available).toBe(false);
    });

    it('falls through to direct exec when which returns empty', () => {
      vi.spyOn(require('child_process'), 'execSync')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('1.21.3\n');

      const { checkCliTool } = require('../detect-deps');
      const result = checkCliTool('lizard');

      expect(result.available).toBe(true);
      expect(result.path).toBe('lizard');
      expect(result.version).toBe('1.21.3');
    });

    it('uses where on win32 instead of which', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const execSpy = vi.spyOn(require('child_process'), 'execSync')
        .mockReturnValueOnce('C:\\Users\\test\\AppData\\Roaming\\npm\\jscpd.cmd\r\n')
        .mockReturnValueOnce('cpd 5.0.11\n');

      const { checkCliTool } = require('../detect-deps');
      const result = checkCliTool('jscpd');

      expect(result.available).toBe(true);
      expect(execSpy.mock.calls[0][0]).toMatch(/^where jscpd/);
      expect(execSpy.mock.calls[0][1].shell).toBe('cmd.exe');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses 2>nul on win32 instead of 2>/dev/null', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const execSpy = vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });

      const { checkCliTool } = require('../detect-deps');
      checkCliTool('jscpd');

      const versionCallArgs = execSpy.mock.calls.map(c => c[0]);
      const hasUnixRedir = versionCallArgs.some(cmd => typeof cmd === 'string' && cmd.includes('2>/dev/null'));
      expect(hasUnixRedir).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses 2>/dev/null on linux (not 2>nul)', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const execSpy = vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });

      const { checkCliTool } = require('../detect-deps');
      checkCliTool('jscpd');

      const versionCallArgs = execSpy.mock.calls.map(c => c[0]);
      const hasWindowsRedir = versionCallArgs.some(cmd => typeof cmd === 'string' && cmd.includes('2>nul'));
      expect(hasWindowsRedir).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('explicitly sets shell option for cross-platform consistency', () => {
      const execSpy = vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });

      const { checkCliTool } = require('../detect-deps');
      checkCliTool('jscpd');

      for (const call of execSpy.mock.calls) {
        expect(call[1].shell).toBeDefined();
      }
    });

    it('sets timeout to 15000ms for version checks (Python cold start)', () => {
      const execSpy = vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });

      const { checkCliTool } = require('../detect-deps');
      checkCliTool('checkov');

      const locatorCalls = execSpy.mock.calls.filter(c => c[1].timeout === 15000);
      expect(locatorCalls.length).toBeGreaterThan(0);
    });

    it('checks ~/.local/bin fallback path when tool not in PATH', () => {
      vi.spyOn(require('child_process'), 'execSync')
        .mockImplementation(() => { throw new Error('not found'); });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(require('child_process'), 'execSync')
        .mockImplementationOnce(() => { throw new Error('which: not found'); })
        .mockImplementationOnce(() => { throw new Error('direct exec: not found'); })
        .mockReturnValueOnce('hadolint 2.14.0\n');

      const { checkCliTool } = require('../detect-deps');
      const result = checkCliTool('hadolint');

      expect(result.available).toBe(true);
      expect(result.path).toContain('.local');
    });
  });
});
