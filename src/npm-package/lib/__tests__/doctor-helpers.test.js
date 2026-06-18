/**
 * @test TECH-001 Extracted doctor.js fix helpers (CCN reduction)
 * @intent Unit-test each extracted helper in isolation
 * @covers TECH-001
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('fixVersionMismatch', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dh-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  function ensureConfigDir() {
    const cfgDir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(cfgDir, { recursive: true });
  }

  it('updates config version when package version differs', () => {
    ensureConfigDir();
    delete require.cache[require.resolve('../doctor')];
    const doc = require('../doctor');
    const config = { version: '0.3.1.1', mode: 'local' };
    const result = doc.fixVersionMismatch(config, '0.9.3.0');
    expect(result).toBe(true);
    expect(config.version).toBe('0.9.3.0');
  });

  it('skips when package version is null', () => {
    delete require.cache[require.resolve('../doctor')];
    const doc = require('../doctor');
    const config = { version: '0.3.1.1', mode: 'local' };
    const result = doc.fixVersionMismatch(config, null);
    expect(result).toBe(false);
    expect(config.version).toBe('0.3.1.1');
  });

  it('skips when versions already match', () => {
    delete require.cache[require.resolve('../doctor')];
    const doc = require('../doctor');
    const config = { version: '0.9.3.0', mode: 'local' };
    const result = doc.fixVersionMismatch(config, '0.9.3.0');
    expect(result).toBe(false);
    expect(config.version).toBe('0.9.3.0');
  });
});

describe('fixMissingHooks', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dh-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dh-proj-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    if (tmpProject && fs.existsSync(tmpProject)) {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  it('restores pre-commit and pre-push hooks for local mode', () => {
    delete require.cache[require.resolve('../doctor')];
    const srcDir = path.join(__dirname, '..', '..');
    const hooksDir = path.join(tmpProject, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const preCommit = path.join(hooksDir, 'pre-commit');
    if (fs.existsSync(preCommit)) fs.unlinkSync(preCommit);
    const doc = require('../doctor');
    const result = doc.fixMissingHooks('local', srcDir, hooksDir);
    expect(result).toBe(true);
    expect(fs.existsSync(preCommit)).toBe(true);
  });
});

describe('fixMissingAdapters', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dh-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dh-proj-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    if (tmpProject && fs.existsSync(tmpProject)) {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  it('copies adapters when directory is missing', () => {
    delete require.cache[require.resolve('../doctor')];
    const srcDir = path.join(__dirname, '..', '..');
    const adaptersDir = path.join(tmpProject, 'githooks', 'adapters');
    if (fs.existsSync(adaptersDir)) {
      fs.rmSync(path.join(tmpProject, 'githooks'), { recursive: true, force: true });
    }
    const doc = require('../doctor');
    const result = doc.fixMissingAdapters('local', srcDir, adaptersDir);
    expect(result).toBe(true);
    expect(fs.existsSync(adaptersDir)).toBe(true);
    const files = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh'));
    expect(files.length).toBeGreaterThan(0);
  });
});
