/**
 * @test REQ-265 update-hooks command
 * @intent Verify updateHooks correctly syncs hook files with proper backup, dry-run, scope, and detection behavior
 * @covers AC-265-01, AC-265-02, AC-265-03, AC-265-04, AC-265-05
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('updateHooks', () => {
  let tmpHome;
  let tmpProject;
  let tmpPackage;
  let originalHome;
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-uh-home-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-uh-proj-'));
    tmpPackage = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-uh-pkg-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(tmpPackage, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Helper: create a fake package structure under tmpPackage */
  function createPackageSource(overrides = {}) {
    const hooksDir = path.join(tmpPackage, 'hooks');
    const adaptersDir = path.join(tmpPackage, 'adapters');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(adaptersDir, { recursive: true });

    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), overrides['hooks/pre-commit'] || '#!/bin/bash\necho "hook-v2"');
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), overrides['hooks/pre-push'] || '#!/bin/bash\necho "push-v2"');
    fs.writeFileSync(path.join(tmpPackage, 'adapter-common.sh'), overrides['adapter-common.sh'] || '#!/bin/bash\necho "adapter-common-v2"');
    fs.writeFileSync(path.join(adaptersDir, 'typescript.sh'), overrides['adapters/typescript.sh'] || '#!/bin/bash\necho "ts-v2"');
    fs.writeFileSync(path.join(adaptersDir, 'python.sh'), overrides['adapters/python.sh'] || '#!/bin/bash\necho "py-v2"');
    fs.writeFileSync(path.join(tmpPackage, 'gate-3.sh'), overrides['gate-3.sh'] || '#!/bin/bash\necho "gate3-v2"');
    fs.writeFileSync(path.join(tmpPackage, 'gate-4.sh'), overrides['gate-4.sh'] || '#!/bin/bash\necho "gate4-v2"');
  }

  /** Helper: get fresh updateHooks module */
  function getModule() {
    delete require.cache[require.resolve('../update-hooks')];
    delete require.cache[require.resolve('../shared-paths')];
    return require('../update-hooks');
  }

  // ===== copyHooks tests =====

  describe('copyHooks', () => {
    it('copies pre-commit and pre-push to destination', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'hooks-dest');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyHooks(tmpPackage, dest, false, true);

      expect(fs.readFileSync(path.join(dest, 'pre-commit'), 'utf8')).toContain('hook-v2');
      expect(fs.readFileSync(path.join(dest, 'pre-push'), 'utf8')).toContain('push-v2');
    });

    it('creates destination directory if it does not exist', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'deep', 'nested', 'hooks');

      mod.copyHooks(tmpPackage, dest, false, true);

      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.existsSync(path.join(dest, 'pre-commit'))).toBe(true);
    });

    it('sets executable permissions (0o755) on copied hooks', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'hooks-perm');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyHooks(tmpPackage, dest, false, true);

      const stat = fs.statSync(path.join(dest, 'pre-commit'));
      expect(stat.mode & 0o100).toBeTruthy();
    });
  });

  // ===== copyAdapters tests =====

  describe('copyAdapters', () => {
    it('copies adapter-common.sh and adapters/*.sh', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'adapters-dest');
      fs.mkdirSync(path.join(dest, 'adapters'), { recursive: true });

      mod.copyAdapters(tmpPackage, dest, false, true);

      expect(fs.readFileSync(path.join(dest, 'adapter-common.sh'), 'utf8')).toContain('adapter-common-v2');
      expect(fs.readFileSync(path.join(dest, 'adapters', 'typescript.sh'), 'utf8')).toContain('ts-v2');
      expect(fs.readFileSync(path.join(dest, 'adapters', 'python.sh'), 'utf8')).toContain('py-v2');
    });

    it('creates adapters subdirectory if it does not exist', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'adapters-new');

      mod.copyAdapters(tmpPackage, dest, false, true);

      expect(fs.existsSync(path.join(dest, 'adapters', 'typescript.sh'))).toBe(true);
    });
  });

  // ===== copyGateScripts tests =====

  describe('copyGateScripts', () => {
    it('copies gate-*.sh scripts from package root', () => {
      createPackageSource();
      const mod = getModule();
      const dest = path.join(tmpProject, 'gates-dest');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyGateScripts(tmpPackage, dest, false, true);

      expect(fs.readFileSync(path.join(dest, 'gate-3.sh'), 'utf8')).toContain('gate3-v2');
      expect(fs.readFileSync(path.join(dest, 'gate-4.sh'), 'utf8')).toContain('gate4-v2');
    });

    it('copies sprint-gate.sh alongside gate-*.sh scripts (#335)', () => {
      createPackageSource();
      fs.writeFileSync(path.join(tmpPackage, 'sprint-gate.sh'), '#!/bin/bash\necho "sprint-gate-v1"');
      const mod = getModule();
      const dest = path.join(tmpProject, 'gates-sprint');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyGateScripts(tmpPackage, dest, false, true);

      expect(fs.readFileSync(path.join(dest, 'sprint-gate.sh'), 'utf8')).toContain('sprint-gate-v1');
    });

    it('does not copy non-gate files', () => {
      createPackageSource();
      fs.writeFileSync(path.join(tmpPackage, 'some-other.sh'), 'echo other');
      const mod = getModule();
      const dest = path.join(tmpProject, 'gates-other');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyGateScripts(tmpPackage, dest, false, true);

      expect(fs.existsSync(path.join(dest, 'some-other.sh'))).toBe(false);
    });

    it('handles missing source directory gracefully', () => {
      const mod = getModule();
      const dest = path.join(tmpProject, 'gates-empty');
      fs.mkdirSync(dest, { recursive: true });

      mod.copyGateScripts('/nonexistent/path', dest, false, true);

      const gateFiles = fs.readdirSync(dest).filter(f => f.startsWith('gate-'));
      expect(gateFiles).toEqual([]);
    });
  });

  // ===== atomicCopyFile tests =====

  describe('atomicCopyFile', () => {
    it('returns false when source does not exist', () => {
      const mod = getModule();
      const result = mod.atomicCopyFile('/nonexistent/file', '/tmp/dest', false, true, 'test-file');
      expect(result).toBe(false);
    });

    it('warns when source does not exist', () => {
      const mod = getModule();
      mod.atomicCopyFile('/nonexistent/file', '/tmp/dest', false, true, 'test-file');
      expect(warnSpy).toHaveBeenCalledWith('  ⚠ test-file not found, skipping');
    });

    it('returns true and logs in dry-run mode for existing source', () => {
      createPackageSource();
      const mod = getModule();
      const src = path.join(tmpPackage, 'hooks', 'pre-commit');
      const dest = path.join(tmpProject, 'dry-dest', 'pre-commit');
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      const result = mod.atomicCopyFile(src, dest, true, true, 'pre-commit');
      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith('  would update: pre-commit');
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('returns false in dry-run mode when source does not exist', () => {
      const mod = getModule();
      const result = mod.atomicCopyFile('/nonexistent/file', '/tmp/dest', true, true, 'test-file');
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('  ⚠ test-file not found, skipping');
    });

    it('uses atomic write (temp file + rename)', () => {
      createPackageSource();
      const mod = getModule();
      const src = path.join(tmpPackage, 'hooks', 'pre-commit');
      const dest = path.join(tmpProject, 'atomic-dest', 'pre-commit');
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      mod.atomicCopyFile(src, dest, false, true, 'pre-commit');

      expect(fs.readFileSync(dest, 'utf8')).toContain('hook-v2');
      expect(fs.existsSync(`${dest}.tmp`)).toBe(false);
    });

    it('creates .bak backup when backup enabled and dest exists', () => {
      createPackageSource();
      const mod = getModule();
      const src = path.join(tmpPackage, 'hooks', 'pre-commit');
      const destDir = path.join(tmpProject, 'bak-dest');
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'pre-commit'), '#!/bin/bash\necho "old"');

      mod.atomicCopyFile(src, path.join(destDir, 'pre-commit'), false, false, 'pre-commit');

      expect(fs.existsSync(path.join(destDir, 'pre-commit.bak'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'pre-commit.bak'), 'utf8')).toContain('old');
      expect(fs.readFileSync(path.join(destDir, 'pre-commit'), 'utf8')).toContain('hook-v2');
    });

    it('skips backup when noBackup is true', () => {
      createPackageSource();
      const mod = getModule();
      const src = path.join(tmpPackage, 'hooks', 'pre-commit');
      const destDir = path.join(tmpProject, 'nobak-dest');
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'pre-commit'), '#!/bin/bash\necho "old"');

      mod.atomicCopyFile(src, path.join(destDir, 'pre-commit'), false, true, 'pre-commit');

      expect(fs.existsSync(path.join(destDir, 'pre-commit.bak'))).toBe(false);
      expect(fs.readFileSync(path.join(destDir, 'pre-commit'), 'utf8')).toContain('hook-v2');
    });
  });

  // ===== detectLocalModifications tests =====

  describe('detectLocalModifications', () => {
    it('detects modified hook files', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-det');
      const adaptersDest = path.join(tmpProject, 'adapters-det');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      fs.writeFileSync(path.join(hooksDest, 'pre-commit'), '#!/bin/bash\necho "custom"');
      fs.writeFileSync(path.join(hooksDest, 'pre-push'), '#!/bin/bash\necho "push-v2"');

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toContain('pre-commit');
      expect(modified).not.toContain('pre-push');
    });

    it('detects modified adapter files', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-det2');
      const adaptersDest = path.join(tmpProject, 'adapters-det2');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      fs.writeFileSync(path.join(adaptersDest, 'adapter-common.sh'), '#!/bin/bash\necho "custom-adapter"');

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toContain('adapter-common.sh');
    });

    it('detects modified adapter sub-files', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-det3');
      const adaptersDest = path.join(tmpProject, 'adapters-det3');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      fs.writeFileSync(path.join(adaptersDest, 'adapters', 'typescript.sh'), '#!/bin/bash\necho "custom-ts"');

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toContain('adapters/typescript.sh');
    });

    it('detects modified gate scripts', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-det4');
      const adaptersDest = path.join(tmpProject, 'adapters-det4');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      fs.writeFileSync(path.join(adaptersDest, 'gate-3.sh'), '#!/bin/bash\necho "custom-gate3"');

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toContain('gate-3.sh');
    });

    it('returns empty array when files match source', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-match');
      const adaptersDest = path.join(tmpProject, 'adapters-match');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      fs.writeFileSync(path.join(hooksDest, 'pre-commit'), '#!/bin/bash\necho "hook-v2"');
      fs.writeFileSync(path.join(hooksDest, 'pre-push'), '#!/bin/bash\necho "push-v2"');
      fs.writeFileSync(path.join(adaptersDest, 'adapter-common.sh'), '#!/bin/bash\necho "adapter-common-v2"');

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toEqual([]);
    });

    it('returns empty array when no dest files exist', () => {
      createPackageSource();
      const mod = getModule();
      const hooksDest = path.join(tmpProject, 'hooks-empty');
      const adaptersDest = path.join(tmpProject, 'adapters-empty');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.mkdirSync(path.join(adaptersDest, 'adapters'), { recursive: true });

      const modified = mod.detectLocalModifications(tmpPackage, hooksDest, adaptersDest);
      expect(modified).toEqual([]);
    });
  });

  // ===== getPackageRoot tests =====

  describe('getPackageRoot', () => {
    it('returns the parent directory of lib/', () => {
      const mod = getModule();
      const root = mod.getPackageRoot();
      const expected = path.resolve(path.dirname(require.resolve('../update-hooks')), '..');
      expect(root).toBe(expected);
    });
  });

  // ===== getProjectHooksDir tests =====

  describe('getProjectHooksDir', () => {
    it('returns .git/hooks path under cwd', () => {
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const result = mod.getProjectHooksDir();
      expect(result).toBe(path.join(tmpProject, '.git', 'hooks'));
    });

    it('throws when .git/ does not exist', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      expect(() => mod.getProjectHooksDir()).toThrow('Not a Git repository');
    });
  });

  // ===== updateHooks integration tests =====

  describe('updateHooks', () => {
    it('returns 0 on success with force flag', () => {
      createPackageSource();
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      const result = mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'all',
      });
      expect(result).toBe(0);

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('returns 1 when local modifications detected and no --force', () => {
      createPackageSource();
      const hooksDest = path.join(tmpProject, '.git', 'hooks');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.writeFileSync(path.join(hooksDest, 'pre-commit'), '#!/bin/bash\necho "custom"');

      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      const result = mod.updateHooks({
        global: false,
        force: false,
        dryRun: false,
        noBackup: true,
        scope: 'all',
      });
      expect(result).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('locally modified'));

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('--force bypasses modification detection', () => {
      createPackageSource();
      const hooksDest = path.join(tmpProject, '.git', 'hooks');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.writeFileSync(path.join(hooksDest, 'pre-commit'), '#!/bin/bash\necho "custom"');

      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      const result = mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'all',
      });
      expect(result).toBe(0);
      expect(fs.readFileSync(path.join(hooksDest, 'pre-commit'), 'utf8')).toContain('hook-v2');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('--dry-run shows plan without writing files', () => {
      createPackageSource();
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      const result = mod.updateHooks({
        global: false,
        force: false,
        dryRun: true,
        noBackup: true,
        scope: 'all',
      });
      expect(result).toBe(0);
      expect(logSpy).toHaveBeenCalledWith('Dry run: yes (no files will be modified)');
      expect(logSpy).toHaveBeenCalledWith('  would update: pre-commit');
      expect(logSpy).toHaveBeenCalledWith('  would update: pre-push');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('--scope hooks only copies hooks', () => {
      createPackageSource();
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'hooks',
      });

      expect(logSpy).toHaveBeenCalledWith('Updating hooks...');
      expect(logSpy).not.toHaveBeenCalledWith('Updating adapters...');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('--scope adapters only copies adapters', () => {
      createPackageSource();
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'adapters',
      });

      expect(logSpy).toHaveBeenCalledWith('Updating adapters...');
      expect(logSpy).not.toHaveBeenCalledWith('Updating hooks...');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('logs mode and destination info', () => {
      createPackageSource();
      const gitDir = path.join(tmpProject, '.git');
      fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'hooks',
      });

      expect(logSpy).toHaveBeenCalledWith('XP-Gate Update Hooks');
      expect(logSpy).toHaveBeenCalledWith('====================');
      expect(logSpy).toHaveBeenCalledWith('Mode: Local');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('logs global mode correctly', () => {
      createPackageSource();
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      mod.updateHooks({
        global: true,
        force: true,
        dryRun: false,
        noBackup: true,
        scope: 'hooks',
      });

      expect(logSpy).toHaveBeenCalledWith('Mode: Global');

      mod.getPackageRoot = origGetPackageRoot;
    });

    it('creates backup files in default mode', () => {
      createPackageSource();
      const hooksDest = path.join(tmpProject, '.git', 'hooks');
      fs.mkdirSync(hooksDest, { recursive: true });
      fs.writeFileSync(path.join(hooksDest, 'pre-commit'), '#!/bin/bash\necho "old"');

      vi.spyOn(process, 'cwd').mockReturnValue(tmpProject);
      const mod = getModule();
      const origGetPackageRoot = mod.getPackageRoot;
      mod.getPackageRoot = () => tmpPackage;

      mod.updateHooks({
        global: false,
        force: true,
        dryRun: false,
        noBackup: false,
        scope: 'hooks',
      });

      expect(fs.existsSync(path.join(hooksDest, 'pre-commit.bak'))).toBe(true);
      expect(fs.readFileSync(path.join(hooksDest, 'pre-commit.bak'), 'utf8')).toContain('old');

      mod.getPackageRoot = origGetPackageRoot;
    });
  });
});
