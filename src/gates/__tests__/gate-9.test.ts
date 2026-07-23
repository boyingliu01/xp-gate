/**
 * Tests for src/gates/gate-9.ts — SAST Security (semgrep + PSScriptAnalyzer).
 * @test REQ-357
 * @intent Verify gate-9 handles semgrep PASS/FAIL/WARN/SKIP, JSON result parsing,
 *         PowerShell project SAST routing, and severity categorization.
 * @covers AC-357-4 (gate-9 TypeScript module with PowerShell SAST support)
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
import { runGate9 } from '../gate-9';

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(fs.existsSync);

describe('gate-9.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('WARNs when semgrep is not installed (non-PS project)', () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('WARN');
    expect(result.messages.some(m => m.includes('semgrep not installed'))).toBe(true);
  });

  it('SKIPs when no supported language files changed', () => {
    // semgrep found
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['README.md', 'data.json'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
  });

  it('PASSes when semgrep finds no vulnerabilities', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '{"results":[]}', stderr: '', pid: 1, output: ['', '{"results":[]}', ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('PASS');
    expect(result.exitCode).toBe(0);
  });

  it('FAILs when semgrep finds CRITICAL/HIGH vulnerabilities', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    const semgrepJson = JSON.stringify({
      results: [{
        check_id: 'javascript.sql-injection',
        path: 'src/db.ts',
        start: { line: 42 },
        extra: { severity: 'CRITICAL', message: 'SQL injection via string concatenation' },
      }],
    });
    mockSpawnSync.mockReturnValueOnce({
      status: 1, stdout: semgrepJson, stderr: '', pid: 1, output: ['', semgrepJson, ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/db.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.some(m => m.includes('CRITICAL/HIGH: 1'))).toBe(true);
    expect(result.messages.some(m => m.includes('BLOCKED'))).toBe(true);
  });

  it('PASSes when semgrep finds only MEDIUM/LOW vulnerabilities', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    const semgrepJson = JSON.stringify({
      results: [{
        check_id: 'javascript.xss',
        path: 'src/ui.ts',
        start: { line: 10 },
        extra: { severity: 'MEDIUM', message: 'Potential XSS' },
      }],
    });
    mockSpawnSync.mockReturnValueOnce({
      status: 1, stdout: semgrepJson, stderr: '', pid: 1, output: ['', semgrepJson, ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/ui.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('PASS');
    expect(result.messages.some(m => m.includes('1 medium/low findings'))).toBe(true);
  });

  it('SKIPs on semgrep runtime error (exit code 2+)', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 3, stdout: '', stderr: 'config error', pid: 1, output: ['', '', 'config error'], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
  });

  it('SKIPs for PowerShell projects with no .ps1 files', () => {
    // detectPowerShell succeeds
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/pwsh\n', stderr: '', pid: 1, output: ['', '/usr/bin/pwsh\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '7.4.0\n', stderr: '', pid: 1, output: ['', '7.4.0\n', ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['README.md'], projectLang: 'powershell' });
    expect(result.status).toBe('SKIP');
  });

  it('WARNs for PowerShell projects when pwsh not available', () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

    const result = runGate9({ changedFiles: ['script.ps1'], projectLang: 'powershell' });
    expect(result.status).toBe('WARN');
  });

  it('handles malformed JSON gracefully', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 1, stdout: 'not valid json', stderr: '', pid: 1, output: ['', 'not valid json', ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('WARN');
    expect(result.messages.some(m => m.includes('Failed to parse'))).toBe(true);
  });
});
