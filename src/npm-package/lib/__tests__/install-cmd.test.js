const fs = require('fs');
const path = require('path');
const os = require('os');

describe('install-cmd', () => {
  let tmpDir;
  let consoleLogSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-install-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exports install function', () => {
    const { install } = require('../install-cmd');
    expect(typeof install).toBe('function');
  });

  it('install accepts --global flag', async () => {
    const { install } = require('../install-cmd');
    const code = await install(['--global'], tmpDir);
    expect(typeof code).toBe('number');
  });

  it('install runs without --global (local mode) in git repo', async () => {
    // Simulate git repo
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });

    const { install } = require('../install-cmd');
    const code = await install([], tmpDir);
    expect(typeof code).toBe('number');
  });
});
