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
import { runGate3, countCcnWarnings } from '../gate-3';

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
      // Real `lizard --csv` row shape: NLOC,CCN,token,PARAM,length,location,file,name.
      // "Warning cnt" never appears in it -- that is a column HEADER in the middle
      // of a table line, and lizard omits the table entirely when given explicit
      // file arguments, which is how this gate always invokes it (#674).
      stdout: '5,2,30,1,5,"src/app.ts@1-5@app","src/app.ts","app@1-5"\n',
      stderr: '',
      pid: 1,
      output: ['', '', ''],
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
    // lizard run — three functions over CCN 5, in lizard's real CSV shape
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: [
        '20,18,90,1,20,"src/app.ts@1-20@classify","src/app.ts","classify@1-20"',
        '10,9,40,1,10,"src/app.ts@22-31@other","src/app.ts","other@22-31"',
        '8,7,30,1,8,"src/app.ts@33-40@third","src/app.ts","third@33-40"',
        '5,2,20,1,5,"src/app.ts@42-46@ok","src/app.ts","ok@42-46"',
        '',
      ].join('\n'),
      stderr: '',
      pid: 1,
      output: ['', '', ''],
      signal: null,
    } as any);

    const result = runGate3({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.some(m => m.includes('3 functions with CCN'))).toBe(true);
  });

  // The parser is tested directly, against literal lizard output. Driving the
  // gate end-to-end cannot prove this: the bug in #674 was that the pattern never
  // matched, so the gate reported PASS -- and a PASS assertion on fabricated
  // `Warning cnt N` text passed for years without ever exercising real output.
  describe('countCcnWarnings (#674)', () => {
    it('counts rows whose CCN exceeds the threshold', () => {
      const csv = [
        '20,18,90,1,20,"a.ts@1-20@f","a.ts","f@1-20"',
        '5,2,20,1,5,"a.ts@22-26@g","a.ts","g@22-26"',
        '8,7,30,1,8,"a.ts@28-35@h","a.ts","h@28-35"',
      ].join('\n');
      expect(countCcnWarnings(csv)).toEqual({ warnings: 2, analysed: true });
    });

    it('reports zero warnings but STILL "analysed" when every row is within threshold', () => {
      const csv = '5,2,20,1,5,"a.ts@1-5@f","a.ts","f@1-5"';
      expect(countCcnWarnings(csv)).toEqual({ warnings: 0, analysed: true });
    });

    it('reports "not analysed" on empty output, so the gate cannot claim a clean pass', () => {
      // The other half of #674: a lizard that produced nothing would otherwise
      // yield 0 warnings and read as PASSED on zero analysed functions.
      expect(countCcnWarnings('')).toEqual({ warnings: 0, analysed: false });
      expect(countCcnWarnings('Traceback: lizard crashed\n')).toEqual({ warnings: 0, analysed: false });
    });

    it('ignores non-numeric CCN columns instead of parsing garbage as 0', () => {
      // Header rows and the table format both put non-numeric text in column 2;
      // treating those as CCN 0 would silently deflate the count.
      const csv = [
        'NLOC,CCN,token,PARAM,length,location',
        '================================================',
        '20,18,90,1,20,"a.ts@1-20@f"',
      ].join('\n');
      expect(countCcnWarnings(csv)).toEqual({ warnings: 1, analysed: true });
    });
  });
});
