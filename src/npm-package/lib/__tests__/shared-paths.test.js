/**
 * @test shared-paths
 * @intent Verify platform-aware template directory resolution
 * @covers Issue #188 — templateDir pointing to OpenCode residue path
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('shared-paths', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-sp-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  function createPlatformMarker(platform) {
    const dirs = {
      opencode: path.join(tmpHome, '.config', 'opencode', 'skills'),
      'claude-code': path.join(tmpHome, '.claude', 'skills'),
      qoder: path.join(tmpHome, '.qoder', 'skills'),
    };
    const dir = dirs[platform];
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  it('returns opencode template dir when no platform marker exists (default)', () => {
    const { TEMPLATE_DIR } = require('../shared-paths');
    expect(TEMPLATE_DIR).toBe(path.join(tmpHome, '.config', 'opencode', 'git-hooks-template'));
  });

  it('returns opencode template dir when opencode platform marker exists', () => {
    createPlatformMarker('opencode');
    const { TEMPLATE_DIR } = require('../shared-paths');
    expect(TEMPLATE_DIR).toBe(path.join(tmpHome, '.config', 'opencode', 'git-hooks-template'));
  });

  it('returns claude-code template dir when claude-code platform marker exists', () => {
    createPlatformMarker('claude-code');
    const { TEMPLATE_DIR } = require('../shared-paths');
    expect(TEMPLATE_DIR).toBe(path.join(tmpHome, '.claude', 'git-hooks-template'));
  });

  it('returns qoder template dir when qoder platform marker exists', () => {
    createPlatformMarker('qoder');
    const { TEMPLATE_DIR } = require('../shared-paths');
    expect(TEMPLATE_DIR).toBe(path.join(tmpHome, '.qoder', 'git-hooks-template'));
  });

  it('qoder marker takes priority over opencode when both exist', () => {
    createPlatformMarker('opencode');
    createPlatformMarker('qoder');
    const { TEMPLATE_DIR } = require('../shared-paths');
    // Qoder should take priority (checked first)
    expect(TEMPLATE_DIR).toBe(path.join(tmpHome, '.qoder', 'git-hooks-template'));
  });

  it('detectPlatform returns opencode when no marker exists', () => {
    const { detectPlatform } = require('../shared-paths');
    expect(detectPlatform()).toBe('opencode');
  });

  it('detectPlatform returns qoder when qoder marker exists', () => {
    createPlatformMarker('qoder');
    const { detectPlatform } = require('../shared-paths');
    expect(detectPlatform()).toBe('qoder');
  });

  it('detectPlatform returns claude-code when claude-code marker exists', () => {
    createPlatformMarker('claude-code');
    const { detectPlatform } = require('../shared-paths');
    expect(detectPlatform()).toBe('claude-code');
  });

  it('getTemplateDir returns correct path for each platform', () => {
    const { getTemplateDir } = require('../shared-paths');

    // No marker → opencode
    expect(getTemplateDir()).toBe(path.join(tmpHome, '.config', 'opencode', 'git-hooks-template'));

    // Qoder marker
    createPlatformMarker('qoder');
    // Need fresh module to re-evaluate
    delete require.cache[require.resolve('../shared-paths')];
    const { getTemplateDir: getTpl2 } = require('../shared-paths');
    expect(getTpl2()).toBe(path.join(tmpHome, '.qoder', 'git-hooks-template'));
  });

  it('CONFIG_DIR and GLOBAL_HOOKS_DIR remain under xp-gate regardless of platform', () => {
    createPlatformMarker('qoder');
    const { CONFIG_DIR, GLOBAL_HOOKS_DIR, GLOBAL_ADAPTERS_DIR } = require('../shared-paths');
    expect(CONFIG_DIR).toBe(path.join(tmpHome, '.config', 'xp-gate'));
    expect(GLOBAL_HOOKS_DIR).toBe(path.join(tmpHome, '.config', 'xp-gate', 'hooks'));
    expect(GLOBAL_ADAPTERS_DIR).toBe(path.join(tmpHome, '.config', 'xp-gate', 'adapters'));
  });
});
