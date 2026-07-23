/**
 * Tests for src/gates/gate-3.ts — Cyclomatic Complexity.
 * @test REQ-357
 * @intent Verify gate-3 handles lizard PASS/FAIL/WARN/SKIP, PowerShell project routing,
 *         documentation-only skip, and file filtering.
 * @covers AC-357-3 (gate-3 TypeScript module with PowerShell support)
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
import { runGate3 } from '../gate-3';

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe('gate-3.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('SKIPs for documentation-only projects', () => {
    const result = runGate3({ changedFiles: [], projectLang: 'documentation-only' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('documentation project'))).toBe(true);
  });

  it('SKIPs for PowerShell projects when pwsh not available', () => {
    // detectPowerShell: all candidates fail
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

    const result = runGate3({ changedFiles: ['script.ps1'], projectLang: 'powershell' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('no PowerShell tool'))).toBe(true);
  });

  it('SKIPs for PowerShell projects with no .ps1 files', () => {
    // pwsh found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/pwsh\n', stderr: '', pid: 1, output: ['', '/usr/bin/pwsh\n', ''], signal: null,
    } as any);
    // version check
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '7.4.0\n', stderr: '', pid: 1, output: ['', '7.4.0\n', ''], signal: null,
    } as any);

    const result = runGate3({ changedFiles: ['README.md'], projectLang: 'powershell' });
    expect(result.status).toBe('SKIP');
  });

  it('WARNs when lizard is not installed', () => {
    // lizard not found: which fails, npx fails
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

    const result = runGate3({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('WARN');
    expect(result.messages.some(m => m.includes('lizard not installed'))).toBe(true);
  });

  it('SKIPs when no source files to check', () => {
    // lizard found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/lizard\n', stderr: '', pid: 1, output: ['', '/usr/bin/lizard\n', ''], signal: null,
    } as any);

    const result = runGate3({ changedFiles: ['README.md', 'data.json'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('no source files'))).toBe(true);
  });

  it('PASSes when all functions within complexity threshold', () => {
    // lizard found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/lizard\n', stderr: '', pid: 1, output: ['', '/usr/bin/lizard\n', ''], signal: null,
    } as any);
    // lizard run — no warnings
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: '================================================\nfile: src/app.ts\n================================================\nWarning cnt   0\n',
      stderr: '',
      pid: 1,
      output: ['', 'Warning cnt   0\n', ''],
      signal: null,
    } as any);

    const result = runGate3({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('PASS');
    expect(result.exitCode).toBe(0);
  });

  it('FAILs when functions exceed complexity threshold', () => {
    // lizard found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/lizard\n', stderr: '', pid: 1, output: ['', '/usr/bin/lizard\n', ''], signal: null,
    } as any);
    // lizard run — 3 warnings
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: 'Warning cnt   3\n',
      stderr: '',
      pid: 1,
      output: ['', 'Warning cnt   3\n', ''],
      signal: null,
    } as any);

    const result = runGate3({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.some(m => m.includes('3 functions with CCN'))).toBe(true);
  });
});
