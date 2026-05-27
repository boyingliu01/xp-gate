/**
 * @test rollback
 * @intent Verify rollback(), createBackup(), cleanupBackup() correctly backup and restore skill directories
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('rollback', () => {
  let tmpHome;
  let originalHome;
  let logSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-rb-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../rollback')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function backupRoot() {
    return path.join(tmpHome, '.config', 'xp-gate', 'backup');
  }

  describe('createBackup', () => {
    it('returns null when targetDir does not exist', async () => {
      const { createBackup } = require('../rollback');
      const result = await createBackup('install-1', 'nonexistent-skill');
      expect(result).toBeNull();
    });

    it('copies dir contents (files) into backup when targetDir exists', async () => {
      const target = path.join(skillsDir(), 'my-skill');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'SKILL.md'), 'content-a');
      fs.writeFileSync(path.join(target, 'README.md'), 'content-b');

      const { createBackup } = require('../rollback');
      const backupPath = await createBackup('install-1', 'my-skill');

      expect(backupPath).toBe(path.join(backupRoot(), 'install-1'));
      expect(fs.existsSync(path.join(backupPath, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, 'README.md'))).toBe(true);
      expect(fs.readFileSync(path.join(backupPath, 'SKILL.md'), 'utf8')).toBe('content-a');
    });

    it('copies nested directories recursively', async () => {
      const target = path.join(skillsDir(), 'nested-skill');
      fs.mkdirSync(path.join(target, 'subdir', 'deeper'), { recursive: true });
      fs.writeFileSync(path.join(target, 'top.txt'), 'top');
      fs.writeFileSync(path.join(target, 'subdir', 'mid.txt'), 'mid');
      fs.writeFileSync(path.join(target, 'subdir', 'deeper', 'bottom.txt'), 'bottom');

      const { createBackup } = require('../rollback');
      const backupPath = await createBackup('install-2', 'nested-skill');

      expect(fs.readFileSync(path.join(backupPath, 'top.txt'), 'utf8')).toBe('top');
      expect(fs.readFileSync(path.join(backupPath, 'subdir', 'mid.txt'), 'utf8')).toBe('mid');
      expect(
        fs.readFileSync(path.join(backupPath, 'subdir', 'deeper', 'bottom.txt'), 'utf8')
      ).toBe('bottom');
    });
  });

  describe('rollback', () => {
    it('is no-op when backup dir does not exist', async () => {
      const { rollback } = require('../rollback');
      await rollback('nonexistent-install');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('restores files from backup to skills dir', async () => {
      // Setup: create backup with one skill entry
      const backupDir = path.join(backupRoot(), 'install-3');
      const backupEntry = path.join(backupDir, 'restored-skill');
      fs.mkdirSync(backupEntry, { recursive: true });
      fs.writeFileSync(path.join(backupEntry, 'SKILL.md'), 'restored content');

      // Ensure skills dir exists (parent of dest must exist for renameSync)
      fs.mkdirSync(skillsDir(), { recursive: true });

      const { rollback } = require('../rollback');
      await rollback('install-3');

      const dest = path.join(skillsDir(), 'restored-skill');
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('restored content');
      // Backup dir removed after rollback
      expect(fs.existsSync(backupDir)).toBe(false);
      expect(logSpy).toHaveBeenCalledWith('Rolling back...');
      expect(logSpy).toHaveBeenCalledWith('Rollback complete');
    });

    it('removes existing dest before restoring from backup', async () => {
      // Pre-existing skill (newer version) that should be overwritten by rollback
      const dest = path.join(skillsDir(), 'overwrite-skill');
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'NEW.md'), 'new content');

      // Backup with old version
      const backupDir = path.join(backupRoot(), 'install-4');
      const backupEntry = path.join(backupDir, 'overwrite-skill');
      fs.mkdirSync(backupEntry, { recursive: true });
      fs.writeFileSync(path.join(backupEntry, 'OLD.md'), 'old content');

      const { rollback } = require('../rollback');
      await rollback('install-4');

      // NEW.md should be gone, OLD.md restored
      expect(fs.existsSync(path.join(dest, 'NEW.md'))).toBe(false);
      expect(fs.existsSync(path.join(dest, 'OLD.md'))).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'OLD.md'), 'utf8')).toBe('old content');
    });

    it('handles multiple skill entries in single backup', async () => {
      const backupDir = path.join(backupRoot(), 'install-5');
      fs.mkdirSync(path.join(backupDir, 'skill-a'), { recursive: true });
      fs.mkdirSync(path.join(backupDir, 'skill-b'), { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'skill-a', 'a.md'), 'A');
      fs.writeFileSync(path.join(backupDir, 'skill-b', 'b.md'), 'B');

      fs.mkdirSync(skillsDir(), { recursive: true });

      const { rollback } = require('../rollback');
      await rollback('install-5');

      expect(fs.existsSync(path.join(skillsDir(), 'skill-a', 'a.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir(), 'skill-b', 'b.md'))).toBe(true);
    });
  });

  describe('cleanupBackup', () => {
    it('removes backup dir when it exists', async () => {
      const backupDir = path.join(backupRoot(), 'install-6');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'stale.txt'), 'stale');

      const { cleanupBackup } = require('../rollback');
      cleanupBackup('install-6');

      expect(fs.existsSync(backupDir)).toBe(false);
    });

    it('is no-op when backup dir does not exist', async () => {
      const { cleanupBackup } = require('../rollback');
      // Should not throw
      expect(() => cleanupBackup('nonexistent-id')).not.toThrow();
    });
  });

  describe('round trip: createBackup + rollback', () => {
    it('createBackup writes entries that rollback restores as top-level skills', async () => {
      const target = path.join(skillsDir(), 'roundtrip-skill');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'v1.txt'), 'version 1');

      const { createBackup, rollback } = require('../rollback');
      await createBackup('rt-install', 'roundtrip-skill');

      const backupDir = path.join(backupRoot(), 'rt-install');
      expect(fs.existsSync(path.join(backupDir, 'v1.txt'))).toBe(true);

      fs.unlinkSync(path.join(target, 'v1.txt'));

      await rollback('rt-install');

      expect(fs.existsSync(path.join(skillsDir(), 'v1.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(skillsDir(), 'v1.txt'), 'utf8')).toBe('version 1');
    });
  });
});
