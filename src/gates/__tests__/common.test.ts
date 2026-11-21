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
      // PATH check fails. The npx fallback is OFF by default (XP_GATE_NPX_PROBE,
      // see AC-GATE-PROBE-05), so there is no second spawn to queue — queueing one
      // would leak into the NEXT test's return value.
      mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any);

      const result = isToolAvailable('nonexistent-tool');
      expect(result.available).toBe(false);
      expect(result.via).toBe('none');
      // Exactly one probe: the PATH lookup. No npx spawn unless explicitly opted in.
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
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

    let originalAudit: string | null = null;

    beforeEach(() => {
      // Snapshot the real journal so the test can put it back byte for byte.
      originalAudit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf-8') : null;
    });

    afterEach(() => {
      // Restore, rather than delete. The old version of this hook did nothing at
      // all -- its body was a comment reading "Just verify it doesn't throw" -- so
      // every run of this suite appended a real `gate-test` row to the
      // developer's own journal. Measured 2026-11-20: 215 such rows in this repo's
      // audit.jsonl, out of 20538.
      //
      // A test that writes to production state and only checks "it didn't throw"
      // leaves the damage in place and calls the run clean.
      try {
        if (originalAudit === null) {
          if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
        } else {
          fs.writeFileSync(auditFile, originalAudit, 'utf-8');
        }
      } catch {
        /* best effort: a restore failure must not mask the assertion result */
      }
    });

    it('writes JSONL entry without throwing', () => {
      expect(() => {
        recordAudit('gate-test', 'test-gate', 'PASS', 0, Date.now() - 100);
      }).not.toThrow();
    });

    it('writes the same field names and types as the bash writer', () => {
      // The two writers had drifted: this one emitted gate/name/status/details
      // while record_gate_audit() emits gate_id/gate_name/passed/issues_found.
      // 315 rows in this repo's journal were written in the TS shape and were
      // invisible to every reader that looks for gate_id.
      const before = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf-8') : '';
      recordAudit('gate-schema-probe', 'schema-probe', 'PASS', 0, Date.now() - 5);
      const after = fs.readFileSync(auditFile, 'utf-8');
      const added = after.slice(before.length).trim().split('\n').filter(Boolean);
      expect(added.length).toBe(1);
      const row = JSON.parse(added[0]);
      expect(row.gate_id).toBe('gate-schema-probe');
      expect(row.gate_name).toBe('schema-probe');
      expect(row.passed).toBe(true);
      expect(typeof row.passed).toBe('boolean');
      expect(typeof row.issues_found).toBe('number');
      expect(row.gate).toBeUndefined();
      expect(row.status).toBeUndefined();
    });

    it('does not write a non-numeric issues_found as a JSON-valid number', () => {
      // recordAudit deliberately has no branch for the NaN case (a ternary or
      // `|| 0` there costs a branch point and Gate 3's ratchet rejected both).
      // The cost is that a non-numeric `details` reaches JSON.stringify as NaN,
      // which it writes as `null`. Pin the actual behaviour so it is a known
      // limitation rather than a surprise.
      const before = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf-8') : '';
      recordAudit('gate-nan-probe', 'nan-probe', 'PASS', 'not-a-number', Date.now() - 5);
      const after = fs.readFileSync(auditFile, 'utf-8');
      const added = after.slice(before.length).trim().split('\n').filter(Boolean);
      expect(added.length).toBe(1);
      const row = JSON.parse(added[0]);
      expect(row.issues_found).toBeNull();
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

/**
 * @test REQ-GATE-EXT-732 The CLI's gate path must also see .mjs/.cjs
 * @intent #732 was filed against the shell gates' `grep -E` regexes, and while
 *         fixing those I found the CLI uses a DIFFERENT implementation:
 *         `xp-gate check 3` routes to src/gates/gate-3.ts, which filters through
 *         LIZARD_EXTENSIONS / SEMGREP_EXTENSIONS here. Fixing only the shell side
 *         would have left `xp-gate check 3` on a .cjs file reporting "no source
 *         files to check" — the issue's own symptom, through the path most users
 *         actually invoke.
 *
 *         Measured end-to-end on a fixture whose only changed file was tool.cjs:
 *         `xp-gate check 3` printed "SKIPPED - Complexity (no source files to
 *         check)" before this fix.
 *
 * @covers AC-732-07 the lizard filter selects mjs/cjs/mts/cts
 * @covers AC-732-08 the semgrep filter selects mjs/cjs/mts/cts
 * @covers AC-732-09 non-source files are still rejected by both
 */
describe('#732 the CLI gate path selects .mjs/.cjs too', () => {
  it('AC-732-07: filterSourceFiles accepts the four module variants', () => {
    const moduleFiles = ['a.mjs', 'b.cjs', 'c.mts', 'd.cts'];
    expect(filterSourceFiles(moduleFiles)).toEqual(moduleFiles);
  });

  it('AC-732-08: filterSemgrepFiles accepts the four module variants', () => {
    // semgrep parses and flags these files (measured: 6 ERROR-level findings on a
    // real .mjs/.cjs fixture), so excluding them meant "the scanner never looked".
    const moduleFiles = ['a.mjs', 'b.cjs', 'c.mts', 'd.cts'];
    expect(filterSemgrepFiles(moduleFiles)).toEqual(moduleFiles);
  });

  it('AC-732-09: non-source files are still rejected', () => {
    // Anti-vacuity: a filter that accepted everything would also pass above.
    expect(filterSourceFiles(['notes.md', 'data.json', 'a.mjs.bak'])).toEqual([]);
    expect(filterSemgrepFiles(['notes.md', 'data.json'])).toEqual([]);
  });
});
