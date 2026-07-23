/**
 * Tests for src/gates/common.ts — shared gate infrastructure.
 * @test REQ-357
 * @intent Verify cross-platform tool detection, process execution, audit logging,
 *         project language detection, and PowerShell support functions.
 * @covers AC-357-1 (common.ts provides all shared utilities)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock child_process before importing module
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
import {
  isToolAvailable,
  runTool,
  recordAudit,
  getChangedFiles,
  detectProjectLang,
  detectPowerShell,
  isPowerShellProject,
  getTempDir,
  filterSourceFiles,
  filterSemgrepFiles,
  filterIaCFiles,
} from '../common';

const mockSpawnSync = vi.mocked(spawnSync);

describe('common.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isToolAvailable', () => {
    it('returns available=true via PATH when tool is found', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '/usr/bin/lizard\n',
        stderr: '',
        pid: 1,
        output: ['', '/usr/bin/lizard\n', ''],
        signal: null,
      } as any);

      const result = isToolAvailable('lizard');
      expect(result.available).toBe(true);
      expect(result.via).toBe('path');
      expect(result.path).toBe('/usr/bin/lizard');
    });

    it('returns available=false when tool is not found anywhere', () => {
      // PATH check fails
      mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);
      // npx check fails
      mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const result = isToolAvailable('nonexistent-tool');
      expect(result.available).toBe(false);
      expect(result.via).toBe('none');
    });
  });

  describe('runTool', () => {
    it('executes command and returns structured result', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: 'output data',
        stderr: '',
        pid: 1,
        output: ['', 'output data', ''],
        signal: null,
      } as any);

      const result = runTool('echo', ['hello']);
      expect(result.stdout).toBe('output data');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('handles non-zero exit codes', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'error occurred',
        pid: 1,
        output: ['', '', 'error occurred'],
        signal: null,
      } as any);

      const result = runTool('false', []);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('error occurred');
    });
  });

  describe('recordAudit', () => {
    const auditDir = path.join(process.cwd(), '.xp-gate');
    const auditFile = path.join(auditDir, 'audit.jsonl');

    afterEach(() => {
      // Clean up test audit entries
      try {
        if (fs.existsSync(auditFile)) {
          const content = fs.readFileSync(auditFile, 'utf-8');
          const lines = content.trim().split('\n');
          // Remove lines we added (keep original)
          if (lines.length > 0) {
            // Just verify it doesn't throw
          }
        }
      } catch { /* ignore */ }
    });

    it('writes JSONL entry without throwing', () => {
      expect(() => {
        recordAudit('gate-test', 'test-gate', 'PASS', 0, Date.now() - 100);
      }).not.toThrow();
    });
  });

  describe('getChangedFiles', () => {
    it('returns file list from git diff --cached', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: 'src/foo.ts\nsrc/bar.ts\n',
        stderr: '',
        pid: 1,
        output: ['', 'src/foo.ts\nsrc/bar.ts\n', ''],
        signal: null,
      } as any);

      const files = getChangedFiles();
      expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('returns empty array when git fails', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 128,
        stdout: '',
        stderr: 'not a git repo',
        pid: 1,
        output: ['', '', 'not a git repo'],
        signal: null,
      } as any);

      const files = getChangedFiles();
      expect(files).toEqual([]);
    });
  });

  describe('detectProjectLang', () => {
    it('detects TypeScript from tsconfig.json', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockImplementation((p: any) => {
        return String(p).endsWith('tsconfig.json');
      });

      expect(detectProjectLang('/fake/project')).toBe('typescript');
      existsSyncSpy.mockRestore();
    });

    it('detects Python from pyproject.toml', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith('pyproject.toml');
      });

      expect(detectProjectLang('/fake/project')).toBe('python');
      existsSyncSpy.mockRestore();
    });

    it('returns unknown when no markers found', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockReturnValue(false);
      const readdirSpy = vi.spyOn(fs, 'readdirSync');
      readdirSpy.mockReturnValue([]);

      expect(detectProjectLang('/fake/project')).toBe('unknown');
      existsSyncSpy.mockRestore();
      readdirSpy.mockRestore();
    });
  });

  describe('detectPowerShell', () => {
    it('detects pwsh when available', () => {
      // which pwsh succeeds
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '/usr/bin/pwsh\n',
        stderr: '',
        pid: 1,
        output: ['', '/usr/bin/pwsh\n', ''],
        signal: null,
      } as any);
      // pwsh version check
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '7.4.0\n',
        stderr: '',
        pid: 1,
        output: ['', '7.4.0\n', ''],
        signal: null,
      } as any);

      const ps = detectPowerShell();
      expect(ps.available).toBe(true);
      expect(ps.version).toBe('7.4.0');
    });

    it('returns unavailable when no PowerShell found', () => {
      // All three candidates fail
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const ps = detectPowerShell();
      expect(ps.available).toBe(false);
    });
  });

  describe('isPowerShellProject', () => {
    it('returns true for powershell', () => {
      expect(isPowerShellProject('powershell')).toBe(true);
    });

    it('returns false for other languages', () => {
      expect(isPowerShellProject('typescript')).toBe(false);
      expect(isPowerShellProject('python')).toBe(false);
    });
  });

  describe('getTempDir', () => {
    it('returns os.tmpdir()', () => {
      expect(getTempDir()).toBe(os.tmpdir());
    });
  });

  describe('file filtering', () => {
    it('filterSourceFiles matches lizard-supported extensions', () => {
      const files = ['src/app.ts', 'README.md', 'lib/util.py', 'data.json', 'main.go'];
      expect(filterSourceFiles(files)).toEqual(['src/app.ts', 'lib/util.py', 'main.go']);
    });

    it('filterSemgrepFiles matches semgrep-supported extensions', () => {
      const files = ['app.ts', 'script.py', 'Main.java', 'style.css', 'data.yaml'];
      expect(filterSemgrepFiles(files)).toEqual(['app.ts', 'script.py', 'Main.java']);
    });

    it('filterIaCFiles matches IaC patterns including PowerShell DSC', () => {
      const files = ['main.tf', 'deploy.yaml', 'Dockerfile', 'app.ts', 'config.configuration.ps1', 'node.mof'];
      expect(filterIaCFiles(files)).toEqual(['main.tf', 'deploy.yaml', 'Dockerfile', 'config.configuration.ps1', 'node.mof']);
    });
  });
});
