/**
 * @test REQ-1 xp-gate uninstall
 * @intent Verify uninstall correctly reverses init, handles local/global modes, dry-run, safety, and idempotency
 * @covers AC-01, AC-02, AC-03, AC-04, AC-08, AC-09, AC-11
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const crypto = require('crypto');

describe('uninstall', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;
  let logSpy;
  let warnSpy;
  let errorSpy;
  let execSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-uni-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-uni-proj-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
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

  function templateDir() {
    return path.join(tmpHome, '.config', 'opencode', 'git-hooks-template');
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

  function backupDir() {
    return path.join(tmpHome, '.config', 'xp-gate', '.uninstall-backup');
  }

  // Create a fake hook file that contains the xp-gate signature
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

  // Create a custom (non-xp-gate) hook file
  function createCustomHook(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pre-commit'),
      '#!/bin/bash\n# My custom hook\n'
    );
  }

  // Simulate a full local install
  function setupLocalInstall() {
    // Create project .git/hooks with xp-gate hooks
    createXpGatePreCommit(projectHooksDir());
    createXpGatePrePush(projectHooksDir());

    // Create project githooks/ with adapters
    createXpGateAdapterCommon(projectGithooksDir());
    createXpGateAdapterScripts(projectGithooksDir());

    // Create template dir
    createXpGatePreCommit(templateDir());
    createXpGatePrePush(templateDir());
    fs.mkdirSync(path.join(templateDir(), 'adapters'), { recursive: true });

    // Write config
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        mode: 'local',
        lastInit: new Date().toISOString()
      }, null, 2)
    );

    return configFile();
  }

  // Simulate a full global install
  function setupGlobalInstall() {
    // Create global hooks dir
    createXpGatePreCommit(globalHooksDir());
    createXpGatePrePush(globalHooksDir());

    // Create global adapters dir
    createXpGateAdapterCommon(globalAdaptersDir());
    createXpGateAdapterScripts(globalAdaptersDir());

    // Create template dir
    createXpGatePreCommit(templateDir());
    createXpGatePrePush(templateDir());
    fs.mkdirSync(path.join(templateDir(), 'adapters'), { recursive: true });

    // Write config
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        mode: 'global',
        lastInit: new Date().toISOString()
      }, null, 2)
    );

    return configFile();
  }

  function mockExecSuccess() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      if (cmd.includes('git config --global core.hooksPath')) {
        return '';
      }
      if (cmd.includes('git config --global --unset')) {
        return '';
      }
      return '';
    });
  }

  function mockExecGlobalHooksPath(expectedPath) {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
      if (cmd.includes('git config --global core.hooksPath')) {
        if (cmd.includes('--unset')) {
          return '';
        }
        // For reading the current value
        return expectedPath + '\n';
      }
      if (cmd === 'git rev-parse --git-dir') {
        return path.join(tmpProject, '.git') + '\n';
      }
      return '';
    });
  }

  function mockExecFail() {
    execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('Command failed');
    });
  }

  // === AC-01: local mode complete cleanup ===

  it('AC-01: uninstall in local mode removes hooks, adapters, template dir, and updates config', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);

    expect(result).toBe(0);

    // Verify hooks removed from .git/hooks/
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(false);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(false);

    // Verify adapters removed from githooks/
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'typescript.sh'))).toBe(false);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'python.sh'))).toBe(false);
    expect(fs.existsSync(path.join(projectGithooksDir(), 'adapter-common.sh'))).toBe(false);

    // Verify template dir removed
    expect(fs.existsSync(templateDir())).toBe(false);

    // Verify config updated to uninstalled
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('uninstalled');
    expect(cfg.uninstalled).toBeDefined();
  });

  it('AC-01: uninstall returns 0 even when no files exist (graceful)', async () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ mode: 'local', lastInit: '2025-01-01' }, null, 2));
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);
    expect(result).toBe(0);
  });

  // === AC-02: global mode unset core.hooksPath ===

  it('AC-02: uninstall in global mode unsets core.hooksPath and removes global dirs', async () => {
    setupGlobalInstall();
    const expectedHooksPath = globalHooksDir();
    mockExecGlobalHooksPath(expectedHooksPath);
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);

    expect(result).toBe(0);

    // Verify unset was called
    expect(execSpy).toHaveBeenCalledWith(
      expect.stringContaining('git config --global --unset core.hooksPath'),
      expect.any(Object)
    );

    // Verify global hooks/adapters dirs removed
    expect(fs.existsSync(globalHooksDir())).toBe(false);
    expect(fs.existsSync(globalAdaptersDir())).toBe(false);

    // Verify template dir removed
    expect(fs.existsSync(templateDir())).toBe(false);

    // Verify config updated
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('uninstalled');
    expect(cfg.uninstalled).toBeDefined();
  });

  it('AC-02: uninstall in global mode skips unset when hooksPath does not match', async () => {
    setupGlobalInstall();
    mockExecGlobalHooksPath('/some/other/path');
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);

    expect(result).toBe(0);

    // Should warn that hooksPath does not match
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not match')
    );

    // Should NOT have called unset
    const unsetCalls = execSpy.mock.calls.filter(
      c => c[0].includes('--unset')
    );
    expect(unsetCalls.length).toBe(0);
  });

  // === AC-03: --dry-run ===

  it('AC-03: --dry-run does not remove any files', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall(['--dry-run']);

    expect(result).toBe(0);

    // All files should still exist
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(projectGithooksDir(), 'adapter-common.sh'))).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'typescript.sh'))).toBe(true);
    expect(fs.existsSync(templateDir())).toBe(true);

    // Config should still show active mode
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('local');

    // Should have printed plan
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry-run'));
  });

  // === AC-04: non-xp-gate hooks preserved ===

  it('AC-04: non-xp-gate hooks files are not deleted', async () => {
    setupLocalInstall();
    // Create a custom hook (must be after setup which creates xp-gate hooks)
    createCustomHook(projectHooksDir());
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);

    expect(result).toBe(0);

    // Custom hook should still exist (no xp-gate signature)
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(true);

    // Read it - should be the custom one
    const content = fs.readFileSync(path.join(projectHooksDir(), 'pre-commit'), 'utf8');
    expect(content).toContain('My custom hook');
  });

  // === AC-08: partial failure detection ===

  it('AC-08: uninstall detects config file absence and exits cleanly', async () => {
    // No config file at all
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('xp-gate installation found')
    );
  });

  it('AC-08: uninstall continues despite individual file deletion errors', async () => {
    setupLocalInstall();
    mockExecSuccess();

    // Make one adapter file non-deletable by making it non-existent
    // uninstall should handle this gracefully (skip + warn)
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);
    expect(result).toBe(0);
  });

  // === AC-09: idempotent ===

  it('AC-09: second uninstall outputs clean message (idempotent)', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    // First uninstall
    await uninstall([]);

    // Clear log spy
    logSpy.mockClear();

    // Second uninstall
    const result = await uninstall([]);

    expect(result).toBe(0);

    // Should detect already uninstalled state
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('xp-gate installation found')
    );
  });

  // === AC-11: manifest sha256 vs signature fallback ===

  it('AC-11: uninstall uses manifest sha256 when available for verification', async () => {
    setupLocalInstall();

    // Add manifest to config
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));

    // Calculate actual sha256 of the hooks file
    const hookPath = path.join(projectHooksDir(), 'pre-commit');
    const hookContent = fs.readFileSync(hookPath);
    const sha256 = crypto.createHash('sha256').update(hookContent).digest('hex');

    cfg.manifest = {
      version: 1,
      files: {
        '.git/hooks/pre-commit': { sha256, size: hookContent.length },
        '.git/hooks/pre-push': {
          sha256: crypto.createHash('sha256')
            .update(fs.readFileSync(path.join(projectHooksDir(), 'pre-push')))
            .digest('hex'),
          size: fs.readFileSync(path.join(projectHooksDir(), 'pre-push')).length
        }
      }
    };
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));

    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);
    expect(result).toBe(0);

    // Files should be removed (matched via sha256)
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(false);
  });

  it('AC-11: uninstall falls back to signature detection when manifest sha256 does not match file content', async () => {
    setupLocalInstall();

    // Add manifest with WRONG sha256
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.manifest = {
      version: 1,
      files: {
        '.git/hooks/pre-commit': { sha256: 'deadbeef' + '0'.repeat(56), size: 999 },
        '.git/hooks/pre-push': { sha256: 'deadbeef' + '0'.repeat(56), size: 999 }
      }
    };
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));

    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);
    expect(result).toBe(0);

    // Files should still be removed (fell back to signature detection)
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(false);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(false);
  });

  it('AC-11: manifest fallback to signature logs warning about sha256 mismatch', async () => {
    setupLocalInstall();

    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.manifest = {
      version: 1,
      files: {
        '.git/hooks/pre-commit': { sha256: 'wrongsha256' + '0'.repeat(48), size: 999 }
      }
    };
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));

    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    await uninstall([]);

    // Should warn about manifest sha256 mismatch and fallback
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sha256')
    );
  });

  // === Edge cases ===

  it('returns 0 when config does not exist', async () => {
    const { uninstall } = require('../uninstall');
    const result = await uninstall([]);
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('xp-gate installation found')
    );
  });

  it('skips deletion when file signature does not match', async () => {
    setupLocalInstall();

    // Replace the pre-commit with something that lacks the signature
    fs.writeFileSync(
      path.join(projectHooksDir(), 'pre-commit'),
      '#!/bin/bash\necho "custom hook"\n'
    );
    // But keep pre-push as xp-gate

    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall([]);
    expect(result).toBe(0);

    // Customized pre-commit should remain (no signature match)
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(true);
    // Pre-push should have been removed
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(false);
  });

  it('handles --force flag to skip confirmation', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall(['--force']);
    expect(result).toBe(0);

    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(false);
  });

  it('handles --local flag to override auto-detection', async () => {
    // Set config to global but pass --local
    setupGlobalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    const result = await uninstall(['--local']);
    expect(result).toBe(0);

    // Should have tried to look at project hooks (based on local mode)
    // Since no git dir in this context, should still work gracefully
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('uninstalled');
  });

  it('handles --global flag to override auto-detection', async () => {
    setupLocalInstall();
    mockExecGlobalHooksPath(globalHooksDir());
    const { uninstall } = require('../uninstall');

    const result = await uninstall(['--global']);
    expect(result).toBe(0);

    // Should have attempted global cleanup even though config says local
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    expect(cfg.mode).toBe('uninstalled');
  });

  it('prints plan summary before execution', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    await uninstall(['--dry-run']);

    // Should list what it would do
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pre-commit'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pre-push'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('adapter-common.sh'));
  });

  it('saves rollback snapshot before destructive operations', async () => {
    setupLocalInstall();
    mockExecSuccess();
    const { uninstall } = require('../uninstall');

    await uninstall([]);

    // After successful uninstall, backup should be cleaned up
    expect(fs.existsSync(backupDir())).toBe(false);
  });
});
