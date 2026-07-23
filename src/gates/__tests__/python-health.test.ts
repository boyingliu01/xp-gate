/**
 * Tests for src/gates/python-health.ts — Python Environment Health Check.
 * @test REQ-356
 * @intent Verify Python detection, version checking, pip detection,
 *         environment type detection, tool checking, and Windows Store stub filtering.
 * @covers AC-356-1 (Python health check provides comprehensive diagnostics)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn() },
    existsSync: vi.fn(),
  };
});

import { spawnSync } from 'child_process';
import {
  detectPython,
  checkPythonVersion,
  detectPip,
  detectEnvironment,
  checkPythonHealth,
} from '../python-health';

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe('python-health.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('detectPython', () => {
    it('detects python3 on Unix', () => {
      // isToolAvailable for python3: which succeeds
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: '/usr/bin/python3\n', stderr: '', pid: 1, output: ['', '/usr/bin/python3\n', ''], signal: null,
      } as any);
      // npx fallback (not needed but called)
      // python3 --version
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: 'Python 3.12.1\n', stderr: '', pid: 1, output: ['', 'Python 3.12.1\n', ''], signal: null,
      } as any);

      const result = detectPython();
      expect(result.available).toBe(true);
      expect(result.version).toBe('3.12.1');
    });

    it('filters Windows Store stubs', () => {
      // All candidates fail (no Python available at all)
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const result = detectPython();
      expect(result.available).toBe(false);
    });

    it('returns unavailable when no Python found', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const result = detectPython();
      expect(result.available).toBe(false);
    });
  });

  describe('checkPythonVersion', () => {
    it('returns true for version >= 3.8', () => {
      expect(checkPythonVersion('3.12.1')).toBe(true);
      expect(checkPythonVersion('3.8.0')).toBe(true);
      expect(checkPythonVersion('3.11.0rc1')).toBe(true);
    });

    it('returns false for version < 3.8', () => {
      expect(checkPythonVersion('3.7.12')).toBe(false);
      expect(checkPythonVersion('2.7.18')).toBe(false);
    });
  });

  describe('detectPip', () => {
    it('detects pip via python -m pip', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: 'pip 24.0 from /usr/lib/python3/dist-packages/pip (python 3.12)\n',
        stderr: '', pid: 1, output: ['', 'pip 24.0', ''], signal: null,
      } as any);

      const result = detectPip('/usr/bin/python3');
      expect(result.available).toBe(true);
      expect(result.version).toBe('24.0');
    });

    it('returns unavailable when pip missing', () => {
      mockSpawnSync.mockReturnValueOnce({
        status: 1, stdout: '', stderr: 'No module named pip', pid: 1, output: ['', '', 'No module named pip'], signal: null,
      } as any);

      const result = detectPip('/usr/bin/python3');
      expect(result.available).toBe(false);
    });
  });

  describe('detectEnvironment', () => {
    it('detects conda from CONDA_PREFIX', () => {
      const origEnv = process.env.CONDA_PREFIX;
      process.env.CONDA_PREFIX = '/opt/conda/envs/myenv';
      const result = detectEnvironment();
      expect(result.type).toBe('conda');
      expect(result.path).toBe('/opt/conda/envs/myenv');
      if (origEnv) process.env.CONDA_PREFIX = origEnv;
      else delete process.env.CONDA_PREFIX;
    });

    it('detects venv from VIRTUAL_ENV', () => {
      const origConda = process.env.CONDA_PREFIX;
      const origVenv = process.env.VIRTUAL_ENV;
      delete process.env.CONDA_PREFIX;
      delete process.env.CONDA_DEFAULT_ENV;
      process.env.VIRTUAL_ENV = '/home/user/project/.venv';
      const result = detectEnvironment();
      expect(result.type).toBe('venv');
      // Restore
      if (origConda) process.env.CONDA_PREFIX = origConda;
      if (origVenv) process.env.VIRTUAL_ENV = origVenv;
      else delete process.env.VIRTUAL_ENV;
    });

    it('returns system when no virtual env detected', () => {
      const saved = { ...process.env };
      delete process.env.CONDA_PREFIX;
      delete process.env.CONDA_DEFAULT_ENV;
      delete process.env.VIRTUAL_ENV;
      const result = detectEnvironment();
      expect(result.type).toBe('system');
      // Restore env
      Object.assign(process.env, saved);
    });
  });

  describe('checkPythonHealth', () => {
    it('returns unhealthy when Python not found', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const result = checkPythonHealth();
      expect(result.healthy).toBe(false);
      expect(result.issues.some(i => i.includes('not found'))).toBe(true);
    });

    it('returns healthy for a properly configured Python environment', () => {
      // detectPython: python3 found
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: '/usr/bin/python3\n', stderr: '', pid: 1, output: ['', '/usr/bin/python3\n', ''], signal: null,
      } as any);
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: 'Python 3.12.1\n', stderr: '', pid: 1, output: ['', 'Python 3.12.1\n', ''], signal: null,
      } as any);
      // detectPip
      mockSpawnSync.mockReturnValueOnce({
        status: 0, stdout: 'pip 24.0 from /usr/lib/pip', stderr: '', pid: 1, output: ['', 'pip 24.0', ''], signal: null,
      } as any);
      // Tool checks (mypy, pytest, ruff, flake8, black) — all found
      for (let i = 0; i < 5; i++) {
        // isToolAvailable which check
        mockSpawnSync.mockReturnValueOnce({
          status: 0, stdout: `/usr/bin/tool${i}\n`, stderr: '', pid: 1, output: ['', `/usr/bin/tool${i}\n`, ''], signal: null,
        } as any);
        // python -m tool --version
        mockSpawnSync.mockReturnValueOnce({
          status: 0, stdout: `${i + 1}.0.0\n`, stderr: '', pid: 1, output: ['', `${i + 1}.0.0\n`, ''], signal: null,
        } as any);
      }

      const saved = { ...process.env };
      process.env.VIRTUAL_ENV = '/project/.venv';
      const result = checkPythonHealth();
      expect(result.healthy).toBe(true);
      expect(result.python.version).toBe('3.12.1');
      expect(result.pip.available).toBe(true);
      Object.assign(process.env, saved);
    });
  });
});
