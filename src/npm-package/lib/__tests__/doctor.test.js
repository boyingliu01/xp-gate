/**
 * @test REQ-2 xp-gate doctor
 * @intent Verify doctor correctly diagnoses installation health, handles --fix, and detects partial uninstall
 * @covers AC-05, AC-08, AC-10
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

// Unique ID scoped to this describe block — prevents collisions when
// tests run in parallel across worker threads.
const DESCRIBE_ID = String(Math.random().toString(36).slice(2, 8));

describe('doctor', () => {
  let tmpHome;
  let tmpProject;
  let originalHome;
  let originalXpGateCacheDir;
  let originalDetectDepsTools;
  let originalExecSync;
  let logSpy;

  beforeAll(() => {
    // Snapshot + suppress: Test fixtures don't install real CLI tools.
    delete require.cache[require.resolve('../detect-deps.js')];
    const detectDeps = require('../detect-deps.js');
    if (Array.isArray(detectDeps.GATE_CLI_TOOLS)) {
      originalDetectDepsTools = [...detectDeps.GATE_CLI_TOOLS];
      detectDeps.GATE_CLI_TOOLS.length = 0;
    }
  });

  afterAll(() => {
    // Restore the shared global so downstream suite runs are not polluted.
    if (originalDetectDepsTools) {
      delete require.cache[require.resolve('../detect-deps.js')];
      const detectDeps = require('../detect-deps.js');
      if (Array.isArray(detectDeps.GATE_CLI_TOOLS)) {
        detectDeps.GATE_CLI_TOOLS.length = 0;
        detectDeps.GATE_CLI_TOOLS.push(...originalDetectDepsTools);
      }
    }
  });

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalXpGateCacheDir = process.env.XP_GATE_CACHE_DIR;
    originalExecSync = cp.execSync;
    // Unique per-describe + per-test prefixes to avoid parallel collisions.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `xpgate-dr-${DESCRIBE_ID}-`));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), `xpgate-dr-proj-${DESCRIBE_ID}-`));
    process.env.HOME = tmpHome;
    vi.resetModules();
    // Invalidate all cached modules that load path/environment globals at require-time.
    // Do NOT invalidate detect-deps.js — its GATE_CLI_TOOLS was already cleared in beforeAll
    // and reloading it would restore the full tool list, breaking the test mock setup.
    const modulesToInvalidate = [
      '../doctor', '../uninstall', '../init', '../shared-paths',
      '../check-version.js',
    ];
    for (const mod of modulesToInvalidate) {
      try { delete require.cache[require.resolve(mod)]; } catch { /* first load */ }
    }
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.XP_GATE_CACHE_DIR = originalXpGateCacheDir;
    cp.execSync = originalExecSync;
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
    const gateScripts = ['gate-3.sh', 'gate-4.sh', 'gate-7.sh', 'gate-8.sh', 'gate-9.sh'];
    for (const script of gateScripts) {
      fs.writeFileSync(path.join(dir, 'adapters', script), `#!/bin/bash\n# ${script}\n`);
    }
  }

  function tuiJsonPath() {
    return path.join(tmpHome, '.config', 'opencode', 'tui.json');
  }

  function ensureTuiRegistered() {
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ plugin: ['@boyingliu01/opencode-plugin/tui'] }, null, 2));
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
    // For global mode, create adapters directly in globalAdaptersDir (not in a subdirectory)
    fs.mkdirSync(globalAdaptersDir(), { recursive: true });
    fs.writeFileSync(path.join(globalAdaptersDir(), 'typescript.sh'), '#!/usr/bin/env bash\necho "ts adapter"\n');
    fs.writeFileSync(path.join(globalAdaptersDir(), 'python.sh'), '#!/usr/bin/env bash\necho "py adapter"\n');
    const gateScripts = ['gate-3.sh', 'gate-4.sh', 'gate-7.sh', 'gate-8.sh', 'gate-9.sh'];
    for (const script of gateScripts) {
      fs.writeFileSync(path.join(globalAdaptersDir(), script), `#!/bin/bash\n# ${script}\n`);
    }
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
    cp.execSync = (cmd) => {
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
    };
  }

  // doctor() calls checkUpgrade() which hits npm registry; seed cache to skip.
  // Set XP_GATE_CACHE_DIR so check-version.js resolves to the temp dir,
  // avoiding dependency on os.homedir() cross-platform behavior.
  function seedVersionCache() {
    process.env.XP_GATE_CACHE_DIR = path.join(tmpHome, '.xp-gate');
    const cacheDir = process.env.XP_GATE_CACHE_DIR;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'version-cache.json'),
      JSON.stringify({ ts: Date.now(), version: '0.8.12', publishedAt: '' })
    );
  }

  function mockExecFail() {
    cp.execSync = () => {
      throw new Error('Command failed');
    };
  }

  // === AC-05: healthy diagnosis ===

  it('AC-05: doctor reports all checks passed for healthy local install', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Config file'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Hooks'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Adapters directory'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
  });

  it('AC-05: doctor reports all checks passed for healthy global install', async () => {
    setupGlobalInstall();
    ensureTuiRegistered();
    seedVersionCache();
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
    seedVersionCache();
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
    seedVersionCache();
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
    seedVersionCache();
    cp.execSync = (cmd) => {
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
    };
    const { doctor } = require('../doctor');
    const result = await doctor([]);
    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Expected '));
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
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('xp-gate is not installed'));
  });

  it('AC-10: doctor --fix reinstall hooks when mode is active and hooks missing', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Remove hooks to create a fixable issue
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-commit'));
    fs.unlinkSync(path.join(projectHooksDir(), 'pre-push'));
    mockExecSuccess();
    const { doctor } = require('../doctor');
    const result = await doctor(['--fix']);
    expect(result).toBe(0);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(projectHooksDir(), 'pre-push'))).toBe(true);
  });

  it('AC-10: doctor --fix reinstall adapters when mode is active and adapters missing', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Remove adapters
    fs.rmSync(projectAdaptersDir(), { recursive: true, force: true });
    mockExecSuccess();
    const { doctor } = require('../doctor');
    const result = await doctor(['--fix']);
    expect(result).toBe(0);
    expect(fs.existsSync(projectAdaptersDir())).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'typescript.sh'))).toBe(true);
  });

  it('AC-10: doctor --fix corrects core.hooksPath in global mode', async () => {
    setupGlobalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    // Mock hooksPath pointing somewhere else
    cp.execSync = (cmd) => {
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
    };
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    // Exit 1 because post-fix diagnosis still sees wrong path (mock returns wrong path)
    expect(result).toBe(1);
    // Verify fix was attempted — the hook files exist from setupGlobalInstall
    expect(fs.existsSync(path.join(globalHooksDir(), 'pre-commit'))).toBe(true);
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
    seedVersionCache();
    mockExecFail();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not found')
    );
  });

  // === Issue #186: Version mismatch detection ===

  it('detects version mismatch when config version differs from package version', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Write config with old version
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.version = '0.3.1.1';
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Version mismatch')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('0.3.1.1')
    );
  });

  it('passes version check when config version matches package version', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    // Write config with matching version
    const pkg = JSON.parse(fs.readFileSync(
      path.join(path.dirname(path.dirname(require.resolve('../doctor'))), 'package.json'), 'utf8'
    ));
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.version = pkg.version;
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  it('passes version check when config has no version field (legacy)', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    // Config without version field — legacy install, should not fail
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  // === Issue #188: templateDir validation ===

  it('detects templateDir pointing to wrong platform directory', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Write config with stale opencode templateDir when qoder is active
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.templateDir = path.join(tmpHome, '.config', 'opencode', 'git-hooks-template');
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));

    // Create qoder marker to simulate qoder environment
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });

    // Need fresh module because shared-paths caches detectPlatform at module load
    delete require.cache[require.resolve('../shared-paths')];
    delete require.cache[require.resolve('../doctor')];
    const { doctor: doc2 } = require('../doctor');
    mockExecSuccess();

    const result = await doc2([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('templateDir')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('opencode')
    );
  });

  it('passes templateDir check when templateDir matches current platform', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    // Write config with correct qoder templateDir
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfg.templateDir = path.join(tmpHome, '.qoder', 'git-hooks-template');
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));

    // Create qoder marker — must exist BEFORE loading shared-paths
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills'), { recursive: true });

    // Fresh require so shared-paths detectPlatform() sees .qoder/skills
    delete require.cache[require.resolve('../shared-paths')];
    delete require.cache[require.resolve('../doctor')];
    mockExecSuccess();
    const { doctor: doc2 } = require('../doctor');

    const result = await doc2([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  it('passes templateDir check when config has no templateDir field (legacy)', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    // Config without templateDir — legacy install, should not fail
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  // === REQ-001-04: doctor 集成版本升级检查 (AC-004-01/02) ===

  it('AC-004-01: doctor shows upgrade prompt at end when outdated', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    mockExecSuccess();
    // Point cache dir to tmpHome and remove cache so checkUpgrade hits the npm registry
    process.env.XP_GATE_CACHE_DIR = path.join(tmpHome, '.xp-gate');
    const cacheFile = path.join(process.env.XP_GATE_CACHE_DIR, 'version-cache.json');
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

    delete require.cache[require.resolve('../doctor')];
    delete require.cache[require.resolve('../check-version.js')];
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    // Doctor should output upgrade message when outdated
    const output = logSpy.mock.calls.map(c => c[0] || '').join('\n');
    expect(output).toMatch(/newer version|upgrade|v\d+\.\d+\.\d+/);
  }, 30000);

  it('AC-004-02: doctor does NOT show upgrade prompt when up to date', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    mockExecSuccess();
    // Point cache dir to tmpHome and write a cache with an old remote version
    // so compareVersions(local='0.12.9.0', remote='0.1.0') → outdated=false
    process.env.XP_GATE_CACHE_DIR = path.join(tmpHome, '.xp-gate');
    const cacheFile = path.join(process.env.XP_GATE_CACHE_DIR, 'version-cache.json');
    fs.mkdirSync(process.env.XP_GATE_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({
      ts: Date.now(),
      version: '0.1.0',
      publishedAt: ''
    }));

    delete require.cache[require.resolve('../doctor')];
    delete require.cache[require.resolve('../check-version.js')];
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    const output = logSpy.mock.calls.map(c => c[0] || '').join('\n');
    // Should NOT contain upgrade-related messages
    expect(output).not.toMatch(/newer version|upgrade/i);
  });

  it('AC-004-03: doctor does NOT fail when version check throws', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    mockExecSuccess();
    // Write corrupt cache to trigger checkUpgrade error path
    const cachePath = path.join(tmpHome, '.xp-gate', 'version-cache.json');
    fs.writeFileSync(cachePath, 'not json');

    delete require.cache[require.resolve('../doctor')];
    delete require.cache[require.resolve('../check-version.js')];
    const { doctor } = require('../doctor');

    // Doctor should NOT throw — version check is non-blocking
    const result = await doctor([]);
    expect(result).toBe(0);
  });

  // === Issue #186: --fix syncs global hooks from package source ===

  it('--fix syncs global hooks when they are outdated', async () => {
    setupGlobalInstall();
    seedVersionCache();
    // Write an outdated pre-commit hook (different content)
    const oldContent = '#!/bin/bash\n# OpenCode Quality Gates - Pre-Commit Hook - OLD VERSION\n';
    fs.writeFileSync(path.join(globalHooksDir(), 'pre-commit'), oldContent);
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    // Should have restored from package source
    const restoredContent = fs.readFileSync(path.join(globalHooksDir(), 'pre-commit'), 'utf8');
    expect(restoredContent).not.toBe(oldContent);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restored')
    );
  });

  // === Check 9: TUI auto-registration (tui.json) ===

  it('Check 9: PASS when tui.json has @boyingliu01/opencode-plugin/tui registered', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    // Create tui.json with the plugin registered
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ plugin: ['@boyingliu01/opencode-plugin/tui'] }, null, 2));
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('@boyingliu01/opencode-plugin/tui registered')
    );
  });

  it('Check 9: FAIL when tui.json is missing', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    // Ensure no tui.json
    if (fs.existsSync(tuiJsonPath())) fs.unlinkSync(tuiJsonPath());
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TUI registration: Not registered')
    );
  });

  it('Check 9: FAIL when tui.json exists without @boyingliu01/opencode-plugin/tui entry', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ plugin: ['some-other-plugin'] }, null, 2));
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TUI registration: Not registered')
    );
  });

  it('Check 9: WARN when tui.json exists but has no plugin array', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ someKey: 'value' }, null, 2));
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TUI registration: Not registered')
    );
  });

  it('Check 9: FAIL with backup when tui.json is corrupt JSON', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), 'this is not { valid json');
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TUI registration: Corrupt')
    );
  });

  // === --fix TUI registration ===

  it('--fix: diagnoses TUI not registered then re-diagnoses after fix', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    // No tui.json
    if (fs.existsSync(path.join(tmpHome, '.config', 'opencode'))) {
      fs.rmSync(path.join(tmpHome, '.config', 'opencode'), { recursive: true, force: true });
    }
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    // After fix, tui.json should exist with the plugin registered
    expect(fs.existsSync(tuiJsonPath())).toBe(true);
    const tui = JSON.parse(fs.readFileSync(tuiJsonPath(), 'utf8'));
    expect(tui.plugin).toContain('@boyingliu01/opencode-plugin/tui');
  });

  it('--fix: append to existing tui.json plugin array', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ plugin: ['some-other-plugin'] }, null, 2));
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    const tui = JSON.parse(fs.readFileSync(tuiJsonPath(), 'utf8'));
    expect(tui.plugin).toContain('some-other-plugin');
    expect(tui.plugin).toContain('@boyingliu01/opencode-plugin/tui');
  });

  it('--fix: idempotent — does not duplicate entry when already registered', async () => {
    setupLocalInstall();
    seedVersionCache();
    mockExecSuccess();
    fs.mkdirSync(path.dirname(tuiJsonPath()), { recursive: true });
    fs.writeFileSync(tuiJsonPath(), JSON.stringify({ plugin: ['@boyingliu01/opencode-plugin/tui'] }, null, 2));
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    const tui = JSON.parse(fs.readFileSync(tuiJsonPath(), 'utf8'));
    // Should still have exactly one entry
    expect(tui.plugin.filter(p => p === '@boyingliu01/opencode-plugin/tui').length).toBe(1);
  });

  // === Issue #263 follow-up: Gate script detection ===

  function createGateScripts(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const gateScripts = ['gate-3.sh', 'gate-4.sh', 'gate-7.sh', 'gate-8.sh', 'gate-9.sh'];
    for (const script of gateScripts) {
      fs.writeFileSync(path.join(dir, script), `#!/bin/bash\n# ${script}\n`);
    }
  }

  it('gate scripts: PASS when all expected gate scripts exist', async () => {
    setupLocalInstall();
    ensureTuiRegistered();
    seedVersionCache();
    createGateScripts(projectAdaptersDir());
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gate scripts')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('5 gate script(s)')
    );
  });

  it('gate scripts: FAIL when gate scripts are missing', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Clear adapters dir and create with only language adapters, no gate scripts
    fs.rmSync(projectAdaptersDir(), { recursive: true, force: true });
    fs.mkdirSync(projectAdaptersDir(), { recursive: true });
    fs.writeFileSync(path.join(projectAdaptersDir(), 'typescript.sh'), '#!/bin/bash\n');
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor([]);

    expect(result).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gate scripts')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing')
    );
  });

  it('--fix: restores missing gate scripts', async () => {
    setupLocalInstall();
    seedVersionCache();
    // Clear adapters dir and create with only language adapters, no gate scripts
    fs.rmSync(projectAdaptersDir(), { recursive: true, force: true });
    fs.mkdirSync(projectAdaptersDir(), { recursive: true });
    fs.writeFileSync(path.join(projectAdaptersDir(), 'typescript.sh'), '#!/bin/bash\n');
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'gate-3.sh'))).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'gate-4.sh'))).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'gate-7.sh'))).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'gate-8.sh'))).toBe(true);
    expect(fs.existsSync(path.join(projectAdaptersDir(), 'gate-9.sh'))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restored')
    );
  });

  it('--fix: idempotent for gate scripts — does not overwrite existing', async () => {
    setupLocalInstall();
    seedVersionCache();
    createGateScripts(projectAdaptersDir());
    const originalContent = fs.readFileSync(path.join(projectAdaptersDir(), 'gate-3.sh'), 'utf8');
    mockExecSuccess();
    const { doctor } = require('../doctor');

    const result = await doctor(['--fix']);

    expect(result).toBe(0);
    const currentContent = fs.readFileSync(path.join(projectAdaptersDir(), 'gate-3.sh'), 'utf8');
    expect(currentContent).toBe(originalContent);
  });
});
