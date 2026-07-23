/**
 * Tests for src/gates/gate-8.ts — Secret Scanning (gitleaks).
 * @test REQ-357
 * @intent Verify gate-8 handles tool available/unavailable, PASS/FAIL/SKIP scenarios,
 *         cross-platform temp paths, and config detection.
 * @covers AC-357-2 (gate-8 TypeScript module works cross-platform)
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
    default: { ...actual, existsSync: vi.fn(), appendFileSync: vi.fn(), mkdirSync: vi.fn() },
    existsSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { spawnSync } from 'child_process';
import { runGate8 } from '../gate-8';

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe('gate-8.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('SKIPs when gitleaks is not installed', () => {
    // isToolAvailable: which fails, npx fails, custom path doesn't exist
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

    const result = runGate8({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('gitleaks not installed'))).toBe(true);
  });

  it('PASSes when gitleaks finds no secrets', () => {
    // Tool found via PATH
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/gitleaks\n', stderr: '', pid: 1, output: ['', '/usr/bin/gitleaks\n', ''], signal: null,
    } as any);
    // gitleaks run — exit 0 = no secrets
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null,
    } as any);

    const result = runGate8({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.messages.some(m => m.includes('No secrets detected'))).toBe(true);
  });

  it('FAILs when gitleaks finds secrets (exit code 1)', () => {
    // Tool found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/gitleaks\n', stderr: '', pid: 1, output: ['', '/usr/bin/gitleaks\n', ''], signal: null,
    } as any);
    // gitleaks run — exit 1 = secrets found
    mockSpawnSync.mockReturnValueOnce({
      status: 1, stdout: 'Found API key in src/config.ts', stderr: '', pid: 1, output: ['', 'Found API key', ''], signal: null,
    } as any);

    const result = runGate8({ changedFiles: ['src/config.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.some(m => m.includes('BLOCKED'))).toBe(true);
    expect(result.messages.some(m => m.includes('Remediation'))).toBe(true);
  });

  it('SKIPs on gitleaks runtime error (exit code 2)', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/gitleaks\n', stderr: '', pid: 1, output: ['', '/usr/bin/gitleaks\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 2, stdout: '', stderr: 'config error', pid: 1, output: ['', '', 'config error'], signal: null,
    } as any);

    const result = runGate8({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
    expect(result.exitCode).toBe(0);
  });

  it('uses .gitleaks.toml config when present', () => {
    mockExistsSync.mockImplementation((p: any) => String(p).endsWith('.gitleaks.toml'));
    // Tool found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/gitleaks\n', stderr: '', pid: 1, output: ['', '/usr/bin/gitleaks\n', ''], signal: null,
    } as any);
    // gitleaks run with config
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null,
    } as any);

    const result = runGate8({ changedFiles: ['src/app.ts'], projectLang: 'typescript', cwd: '/project' });
    expect(result.status).toBe('PASS');
    // Verify config was passed in args
    const gitleaksCall = mockSpawnSync.mock.calls[1];
    expect(gitleaksCall[1]).toEqual(expect.arrayContaining([expect.stringContaining('--config=')]));
  });
});
