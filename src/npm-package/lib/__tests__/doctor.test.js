/**
 * @test REQ-2 xp-gate doctor
 * @intent Verify doctor correctly diagnoses installation health, handles --fix, and detects partial uninstall
 * @covers AC-05, AC-08, AC-10
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

describe('doctor', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;
  let logSpy;
  let warnSpy;
  let errorSpy;
  let execSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dr-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dr-proj-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
    delete require.cache[require.resolve('../uninstall')];
    delete require.cache[require.resolve('../init')];
    delete require.cache[require.resolve('../detect-deps.js')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    if (tmpProject && fs.existsSync(tmpProject)) {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function configFile() {
    return path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json');
  }

  function globalHooksDir() {
    return path.join(tmpHome, '.config', 'xp-gate', 'hooks');
  }

  function globalAdaptersDir() {
    return path.join(tmpHome, '.config', 'xp-gate', 'adapters');
  }

  function projectGitDir() {
    return path.join(tmpProject, '.git');
  }

  function projectHooksDir() {
    return path.join(tmpProject, '.git', 'hooks');
  }

  function projectGithooksDir() {
    return path.join(tmpProject, 'githooks');
  }

  function projectAdaptersDir() {
    return path.join(tmpProject, 'githooks', 'adapters');
  }

  function createXpGatePreCommit(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pre-commit'),
      '#!/bin/bash\n# OpenCode Quality Gates - Pre-Commit Hook - Test\n'
    );
  }

  function createXpGatePrePush(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pre-push'),
      '#!/bin/bash\n# Pre-push Hook - Code Walkthrough Result Validator\n'
    );
  }

  function createXpGateAdapterCommon(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'adapter-common.sh'),
      '#!/usr/bin/env bash\n\n# Common adapter functions\ndetect_project_lang() {\n  echo "typescript"\n}\n'
    );
  }

  function createXpGateAdapterScripts(dir) {
    fs.mkdirSync(path.join(dir, 'adapters'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'adapters', 'typescript.sh'),
      '#!/usr/bin/env bash\necho "ts adapter"\n'
    );
    fs.writeFileSync(
      path.join(dir, 'adapters', 'python.sh'),
      '#!/usr/bin/env bash\necho "py adapter"\n'
    );
  }

  function setupLocalInstall() {
    createXpGatePreCommit(projectHooksDir());
    createXpGatePrePush(projectHooksDir());
    createXpGateAdapterCommon(projectGithooksDir());
    createXpGateAdapterScripts(projectGithooksDir());

    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        mode: 'local',
        lastInit: new Date().toISOString()
      }, null, 2)
    );
  }

  function setupGlobalInstall() {
    createXpGatePreCommit(globalHooksDir());
    createXpGatePrePush(globalHooksDir());
    createXpGateAdapterCommon(globalAdaptersDir());
    createXpGateAdapterScripts(globalAdaptersDir());
    createXpGatePreCommit(projectHooksDir());
    createXpGatePrePush(projectHooksDir());
    createXpGateAdapterCommon(projectGithooksDir());
    createXpGateAdapterScripts(projectGithooksDir());

    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        mode: 'global',
        lastInit: new Date().toISOString()
      }, null, 2)
    );
  }

  function mockExecSuccess() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd.includes('git config --global core.hooksPath')) {
        if (cmd.includes('--unset')) {
          return '';
        }
        return globalHooksDir() + '\n';
      }
      if (cmd === 'node --version') {
        return 'v20.0.0\n';
      }
      if (cmd === 'git --version') {
        return 'git version 2.39.0\n';
      }
      if (cmd === 'bash --version') {
        return 'GNU bash, version 5.1.16\n';
      }
      return '';
    });
  }

  function mockExecFail() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('Command failed');
    });
  }

  // === AC-05: healthy diagnosis ===

  it('AC-05: doctor reports all checks passed for healthy local install', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);

    // Should report Config file check
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Config file')
    );

    // Should report hooks check
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Hooks')
    );

    // Should report Adapters directory check
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Adapters directory')
    );

    // Should report all checks passed
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  it('AC-05: doctor reports all checks passed for healthy global install', async () => {
    setupGlobalInstall();
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  // === AC-08: partial uninstall detection ===

  it('AC-08: doctor detects missing hooks in partial install', async () => {
    setupLocalInstall();
    // Remove hooks to simulate partial state
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-commit'));
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-push'));
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('pre-commit')
    );
  });

  it('AC-08: doctor detects missing config file', async () => {
    // No config at all
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Config file: Not found')
    );
  });

  it('AC-08: doctor detects corrupt config JSON', async () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), 'this is not json');

    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Corrupt JSON')
    );
  });

  it('AC-08: doctor detects missing adapters', async () => {
    setupLocalInstall();
    // Remove adapters dir
    fs.rmSync(projectAdaptersDir(), { recursive: true, force: true });
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Adapters directory')
    );
  });

  it('AC-08: doctor detects wrong core.hooksPath in global mode', async () => {
    setupGlobalInstall();
    // Mock hooksPath pointing somewhere else
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd.includes('git config --global core.hooksPath')) {
        if (cmd.includes('--unset')) {
          return '';
        }
        return '/wrong/path\n';
      }
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd === 'node --version') {
        return 'v20.0.0\n';
      }
      if (cmd === 'git --version') {
        return 'git version 2.39.0\n';
      }
      if (cmd === 'bash --version') {
        return 'GNU bash, version 5.1.16\n';
      }
      return '';
    });
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Expected ')
    );
  });

  // === AC-10: --fix only when mode === "active" ===

  it('AC-10: doctor --fix does nothing when mode is uninstalled', async () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ mode: 'uninstalled', uninstalled: '2025-01-01' }, null, 2)
    );

    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    // Should NOT attempt fix operations
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('xp-gate is not installed')
    );
  });

  it('AC-10: doctor --fix reinstall hooks when mode is active and hooks missing', async () => {
    setupLocalInstall();
    // Remove hooks to create a fixable issue
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-commit'));
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-push'));
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    // Should have reinstalled hooks
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(true);
  });

  it('AC-10: doctor --fix reinstall adapters when mode is active and adapters missing', async () => {
    setupLocalInstall();
    // Remove adapters
    fs.rmSync(projectAdaptersDir(), { recursive: true, force: true });
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    // Should have reinstalled adapters
    expect(fs.existsSync(projectAdaptersDir())).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'typescript.sh'))).toBe(true);
  });

  it('AC-10: doctor --fix corrects core.hooksPath in global mode', async () => {
    setupGlobalInstall();
    // Mock hooksPath pointing somewhere else
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd.includes('git config --global core.hooksPath')) {
        if (cmd.includes('--unset')) {
          return '';
        }
        // Return WRONG path to trigger fix
        return '/wrong/path\n';
      }
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd === 'node --version') {
        return 'v20.0.0\n';
      }
      if (cmd === 'git --version') {
        return 'git version 2.39.0\n';
      }
      if (cmd === 'bash --version') {
        return 'GNU bash, version 5.1.16\n';
      }
      return '';
    });
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    // Exit 1 because post-fix diagnosis still sees wrong path (mock returns wrong path)
    // But fix was attempted — verify it called git config --global core.hooksPath with correct path
    expect(result).toBe(1);
    const setCalls = execSpy.mock.calls.filter(
      c => c[0].includes('git config --global core.hooksPath') && !c[0].includes('--unset')
    );
    // Should have at least the fix call: read (wrong path found) + set
    const fixCall = setCalls.find(
      c => c[0].includes('git config --global core.hooksPath') && c[0].includes(globalHooksDir())
    );
    expect(fixCall).toBeTruthy();
  });

  it('AC-10: doctor --fix does NOT fix corrupt config', async () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), 'not valid json');

    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(1);
    // Corrupt config cannot be auto-fixed
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Corrupt JSON')
    );
  });

  // === Edge cases ===

  it('reports exit code 1 with unhealthy or missing install', async () => {
    const { doctor } = require('../doctor');
    const result = await doctor([]);
    expect(result).toBe(1);
  });

  it('detects missing environment dependencies', async () => {
    setupLocalInstall();
    mockExecFail();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not found')
    );
  });
});
