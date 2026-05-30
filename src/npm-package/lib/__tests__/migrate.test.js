/**
 * @test REQ-3 xp-gate migrate
 * @intent Verify migrate helper for v0.4.x→v0.5.x: clean GitHub Packages PAT lines from ~/.npmrc, check old cache
 * @covers AC-06
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('migrate', () => {
  let tmpHome;
  let originalHome;
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-migrate-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../migrate')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function npmrcPath() {
    return path.join(tmpHome, '.npmrc');
  }

  function cacheDir() {
    return path.join(tmpHome, '.config', 'xp-gate', 'cache');
  }

  // === AC-06: clean PAT lines from ~/.npmrc ===

  it('AC-06: removes npm.pkg.github.com lines from ~/.npmrc', async () => {
    fs.writeFileSync(npmrcPath(), [
      '//npm.pkg.github.com/:_authToken=ghp_abc123',
      'registry=https://npm.pkg.github.com/',
      '@boyingliu01:registry=https://npm.pkg.github.com/',
      '//npm.pkg.github.com/:_authToken=ghp_def456',
      '',
      '# other config',
      'cache=/some/path'
    ].join('\n') + '\n');

    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);

    const content = fs.readFileSync(npmrcPath(), 'utf8');
    expect(content).not.toContain('npm.pkg.github.com');
    expect(content).toContain('# other config');
    expect(content).toContain('cache=/some/path');
  });

  it('AC-06: does not remove generic PAT lines (only npm.pkg.github.com)', async () => {
    fs.writeFileSync(npmrcPath(), [
      '//npm.pkg.github.com/:_authToken=ghp_abc123',
      'registry=https://some-other-registry.com/',
      '//other-registry.com/:_authToken=ghp_xyz789',
      'always-auth=true'
    ].join('\n') + '\n');

    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);

    const content = fs.readFileSync(npmrcPath(), 'utf8');
    expect(content).not.toContain('npm.pkg.github.com');
    expect(content).toContain('registry=https://some-other-registry.com/');
    expect(content).toContain('//other-registry.com/:_authToken=ghp_xyz789');
    expect(content).toContain('always-auth=true');
  });

  it('AC-06: prints summary of what was removed from npmrc', async () => {
    fs.writeFileSync(npmrcPath(), [
      '//npm.pkg.github.com/:_authToken=ghp_abc123',
      'cache=/some/path'
    ].join('\n') + '\n');

    const { migrate } = require('../migrate');
    await migrate([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('npm.pkg.github.com'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 npm.pkg.github.com'));
  });

  it('AC-06: does not modify ~/.npmrc when no GitHub Packages lines exist', async () => {
    fs.writeFileSync(npmrcPath(), [
      'registry=https://registry.npmjs.org/',
      'cache=/some/path'
    ].join('\n') + '\n');

    const originalStat = fs.statSync(npmrcPath());
    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);

    const content = fs.readFileSync(npmrcPath(), 'utf8');
    expect(content).toContain('registry=https://registry.npmjs.org/');
    expect(content).toContain('cache=/some/path');
    // File should not have been modified (same content)
    expect(content).toBe('registry=https://registry.npmjs.org/\ncache=/some/path\n');
  });

  // === ~/.npmrc does not exist ===

  it('handles missing ~/.npmrc gracefully (prints skip message)', async () => {
    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No ~/.npmrc found'));
  });

  // === Cache check ===

  it('checks ~/.config/xp-gate/cache/ for old cached downloads', async () => {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), 'old-skill.tar.gz'), 'stale cache data');
    fs.writeFileSync(path.join(cacheDir(), 'manifest.json'), '{}');

    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 cached file(s)'));
  });

  it('prints no cache found message when cache dir is missing', async () => {
    const { migrate } = require('../migrate');
    await migrate([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No old cache'));
  });

  it('prints no cache items when cache dir is empty', async () => {
    fs.mkdirSync(cacheDir(), { recursive: true });

    const { migrate } = require('../migrate');
    await migrate([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('empty'));
  });

  // === --dry-run flag ===

  it('--dry-run: prints what would be done without modifying files', async () => {
    fs.writeFileSync(npmrcPath(), [
      '//npm.pkg.github.com/:_authToken=ghp_abc123',
      'cache=/some/path'
    ].join('\n') + '\n');

    const { migrate } = require('../migrate');
    const result = await migrate(['--dry-run']);

    expect(result).toBe(0);

    // File should remain unchanged
    const content = fs.readFileSync(npmrcPath(), 'utf8');
    expect(content).toContain('npm.pkg.github.com');

    // Should print dry-run plan
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry-run'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 npm.pkg.github.com line'));
  });

  // === Empty npmrc edge case ===

  it('handles empty .npmrc file gracefully', async () => {
    fs.writeFileSync(npmrcPath(), '');

    const { migrate } = require('../migrate');
    const result = await migrate([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No GitHub Packages'));
  });

  // === Print summary ===

  it('prints full summary of actions taken', async () => {
    fs.writeFileSync(npmrcPath(), [
      '//npm.pkg.github.com/:_authToken=ghp_abc123',
      'cache=/some/path'
    ].join('\n') + '\n');

    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), 'old-skill.tar.gz'), 'data');

    const { migrate } = require('../migrate');
    await migrate([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Summary'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('npmrc'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('cache'));
  });
});
