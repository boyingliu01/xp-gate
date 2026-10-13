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
    expect(result.messages.some(m => m.includes('CRITICAL/HIGH/ERROR:     1'))).toBe(true);
    expect(result.messages.some(m => m.includes('BLOCKED'))).toBe(true);
  });

  it('FAILs on an ERROR-severity finding even though semgrep exits 0 (#518 regression)', () => {
    // The #518 repro: semgrep does NOT exit nonzero for findings unless
    // --error is passed. The verdict must come from the JSON.
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    const semgrepJson = JSON.stringify({
      results: [{
        check_id: 'python.lang.security.audit.subprocess-shell-true',
        path: 'src/vuln.py',
        start: { line: 5 },
        extra: { severity: 'ERROR', message: 'subprocess call with shell=True' },
      }],
      errors: [],
    });
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: semgrepJson, stderr: '', pid: 1, output: ['', semgrepJson, ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/vuln.py'], projectLang: 'python' });
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.some(m => m.includes('subprocess-shell-true'))).toBe(true);
  });

  it('FAILs on an unrecognized severity tier (fail-closed, #518 R2)', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    const semgrepJson = JSON.stringify({
      results: [{
        check_id: 'future.rule',
        path: 'src/z.py',
        start: { line: 7 },
        extra: { severity: 'COSMIC', message: 'unrecognized severity tier' },
      }],
      errors: [],
    });
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: semgrepJson, stderr: '', pid: 1, output: ['', semgrepJson, ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/z.py'], projectLang: 'python' });
    expect(result.status).toBe('FAIL');
  });

  it('SKIPs when semgrep exits 0 with zero results but nonzero scan errors (#518 R2)', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    const semgrepJson = JSON.stringify({
      results: [],
      errors: [{ message: 'could not parse src/vuln.py' }],
    });
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: semgrepJson, stderr: '', pid: 1, output: ['', semgrepJson, ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/vuln.py'], projectLang: 'python' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('nothing to judge'))).toBe(true);
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
    expect(result.messages.some(m => m.includes('1 non-blocking findings (warnings only)'))).toBe(true);
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

  it('SKIPs (fail-closed) on malformed JSON instead of WARNing it through (#518)', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '/usr/bin/semgrep\n', stderr: '', pid: 1, output: ['', '/usr/bin/semgrep\n', ''], signal: null,
    } as any);
    mockSpawnSync.mockReturnValueOnce({
      status: 1, stdout: 'not valid json', stderr: 'segfault detail', pid: 1, output: ['', 'not valid json', 'segfault detail'], signal: null,
    } as any);

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('SKIP');
    expect(result.messages.some(m => m.includes('unparseable'))).toBe(true);
  });
});
