/**
 * @test init
 * @intent Verify init() correctly handles global/local installation modes, dependency checks, and config persistence
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

describe('init', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;
  let logSpy;
  let warnSpy;
  let errorSpy;
  let execSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-init-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-proj-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../init')];
    delete require.cache[require.resolve('../detect-deps.js')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function configFile() {
    return path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json');
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

  function mockExecSuccess() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd.includes('git config --global')) {
        return '';
      }
      return '';
    });
  }

  function mockExecGitDirOnly() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd.includes('git config --global')) {
        throw new Error('git config failed');
      }
      return '';
    });
  }

  function mockExecFail() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('Not a git repo');
    });
  }

  it('init([]) prints usage and returns 0', async () => {
    const { init } = require('../init');
    const result = await init([]);
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Choose installation mode:');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('init([]) with valid deps logs Dependencies: OK', async () => {
    setupValidDeps();
    const { init } = require('../init');
    const result = await init([]);
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Dependencies: OK\n');
  });

  it('init([]) with missing superpowers warns Missing dependencies', async () => {
    const { init } = require('../init');
    const result = await init([]);
    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Missing dependencies');
    expect(warnSpy).toHaveBeenCalledWith('  - superpowers (required)');
  });

  it('init([]) with versionMismatch warns version detail', async () => {
    // superpowers too old, gstack good
    const sp = path.join(skillsDir(), 'superpowers');
    fs.mkdirSync(sp, { recursive: true });
    fs.writeFileSync(path.join(sp, 'package.json'), JSON.stringify({ version: '0.0.1' }));
    const gs = path.join(skillsDir(), 'gstack');
    fs.mkdirSync(gs, { recursive: true });
    fs.writeFileSync(path.join(gs, 'package.json'), JSON.stringify({ version: '2.0.0' }));

    const { init } = require('../init');
    const result = await init([]);
    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('superpowers: need 1.0.0, found 0.0.1')
    );
  });

  it('init --global creates global hooks/adapters dirs and writes config', async () => {
    setupValidDeps();
    mockExecSuccess();
    const { init } = require('../init');
    const result = await init(['--global']);
    expect(result).toBe(0);
    expect(fs.existsSync(path.join(tmpHome, '.config', 'xp-gate', 'hooks'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.config', 'xp-gate', 'adapters'))).toBe(true);
    expect(fs.existsSync(configFile())).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('global');
    expect(cfg.lastInit).toBeDefined();
  });

  it('init --core-only fails when not in git repo (returns 1)', async () => {
    mockExecFail();
    const { init } = require('../init');
    const result = await init(['--core-only']);
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Not a git repository');
    expect(errorSpy).toHaveBeenCalledWith('Run xp-gate init from inside a git repository');
  });

  it('init --core-only succeeds in git repo: creates hooks dir + githooks dir + config', async () => {
    fs.mkdirSync(path.join(tmpProject, '.git', 'hooks'), { recursive: true });
    mockExecSuccess();
    const { init } = require('../init');
    const result = await init(['--core-only']);
    expect(result).toBe(0);
    expect(fs.existsSync(path.join(tmpProject, 'githooks', 'adapters'))).toBe(true);
    expect(fs.existsSync(configFile())).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('local');
  });

  it('init --full takes the same installLocal path', async () => {
    fs.mkdirSync(path.join(tmpProject, '.git', 'hooks'), { recursive: true });
    mockExecSuccess();
    const { init } = require('../init');
    const result = await init(['--full']);
    expect(result).toBe(0);
    expect(fs.existsSync(path.join(tmpProject, 'githooks', 'adapters'))).toBe(true);
  });

  it('init --global preserves pre-existing config keys (merge)', async () => {
    setupValidDeps();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ existing: 'data' }));

    const { init } = require('../init');
    const result = await init(['--global']);
    expect(result).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.existing).toBe('data');
    expect(cfg.mode).toBe('global');
  });

  it('init --global with corrupt JSON config overwrites with valid JSON', async () => {
    setupValidDeps();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), '{ invalid json');

    const { init } = require('../init');
    const result = await init(['--global']);
    expect(result).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('global');
  });

  it('init --global warns when git config --global throws', async () => {
    setupValidDeps();
    mockExecGitDirOnly();
    const { init } = require('../init');
    const result = await init(['--global']);
    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Could not set git core.hooksPath config');
  });

  it('init --global logs success messages including final summary', async () => {
    setupValidDeps();
    mockExecSuccess();
    const { init } = require('../init');
    await init(['--global']);
    expect(logSpy).toHaveBeenCalledWith('\nGlobal setup complete!');
    expect(logSpy).toHaveBeenCalledWith(
      'All git repositories will now use xp-gate quality gates.'
    );
  });

  it('init --core-only logs final installation complete', async () => {
    fs.mkdirSync(path.join(tmpProject, '.git', 'hooks'), { recursive: true });
    mockExecSuccess();
    const { init } = require('../init');
    await init(['--core-only']);
    expect(logSpy).toHaveBeenCalledWith('\nInstallation complete!');
    expect(logSpy).toHaveBeenCalledWith('Run git commit to trigger quality gates');
  });

  it('copyHooks copies pre-commit when source file exists', async () => {
    // Write fake hooks to a temp src dir
    // init.js uses srcDir = path.dirname(__dirname) — the src/npm-package dir.
    // We test indirectly via setupGlobal — verify it doesn't throw and creates dest dir.
    setupValidDeps();
    mockExecSuccess();
    // Pre-create a fake hooks file at the real srcDir location
    const realSrcDir = path.dirname(path.dirname(require.resolve('../init')));
    // realSrcDir = src/npm-package
    const hooksSrcDir = path.join(realSrcDir, 'hooks');
    // Don't pollute repo — just verify the dest dir is created even if hooks not present
    const { init } = require('../init');
    const result = await init(['--global']);
    expect(result).toBe(0);
    const destHooks = path.join(tmpHome, '.config', 'xp-gate', 'hooks');
    expect(fs.existsSync(destHooks)).toBe(true);
    // If real hooks exist in repo, they should have been copied
    if (fs.existsSync(path.join(hooksSrcDir, 'pre-commit'))) {
      expect(fs.existsSync(path.join(destHooks, 'pre-commit'))).toBe(true);
    }
  });

  it('init --core-only also creates template dir under HOME', async () => {
    fs.mkdirSync(path.join(tmpProject, '.git', 'hooks'), { recursive: true });
    mockExecSuccess();
    const { init } = require('../init');
    const result = await init(['--core-only']);
    expect(result).toBe(0);
    const tplDir = path.join(tmpHome, '.config', 'opencode', 'git-hooks-template');
    expect(fs.existsSync(tplDir)).toBe(true);
    expect(fs.existsSync(path.join(tplDir, 'adapters'))).toBe(true);
  });

  it('init prints XP-Gate Initialization header', async () => {
    const { init } = require('../init');
    await init([]);
    expect(logSpy).toHaveBeenCalledWith('XP-Gate Initialization');
    expect(logSpy).toHaveBeenCalledWith('====================\n');
  });
});
