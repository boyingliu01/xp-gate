/**
 * @test REQ-GATES-001
 * @intent common-process.ts is a pure move of the process/tool primitives out
 *         of gates/common.ts (Boy Scout module-size split); this pins that the
 *         moved surface still behaves — detection tiers, runTool normalization,
 *         git changed-file parsing, and the PowerShell probe loop
 * @covers AC-GATES-001-01
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'child_process';
import { isToolAvailable, runTool, getChangedFiles, detectPowerShell } from '../common-process';

const spawnMock = spawnSync as ReturnType<typeof vi.fn>;

function ok(stdout: string) {
  return { status: 0, stdout, stderr: '', signal: undefined, error: undefined };
}
function fail() {
  return { status: 1, stdout: '', stderr: 'not found', signal: undefined, error: undefined };
}

describe('common-process primitives', () => {
  beforeEach(() => spawnMock.mockReset());

  it('isToolAvailable finds tools on PATH via tier 1', () => {
    spawnMock.mockReturnValueOnce(ok('/usr/bin/git\n'));
    const result = isToolAvailable('git');
    expect(result).toEqual({ available: true, path: '/usr/bin/git', via: 'path' });
  });

  it('isToolAvailable falls through to unavailable when no tier hits', () => {
    spawnMock.mockReturnValue(fail());
    expect(isToolAvailable('nope').available).toBe(false);
  });

  it('runTool normalizes missing stdout/stderr and non-zero exit', () => {
    spawnMock.mockReturnValue({ status: 3, stdout: null, stderr: undefined, signal: null, error: undefined });
    const r = runTool('x', ['a']);
    expect(r).toEqual({ stdout: '', stderr: '', exitCode: 3, timedOut: false });
  });

  it('runTool reports SIGTERM as timedOut', () => {
    spawnMock.mockReturnValue({ status: null, stdout: '', stderr: '', signal: 'SIGTERM', error: undefined });
    expect(runTool('x', []).timedOut).toBe(true);
  });

  it('getChangedFiles parses staged paths and drops blanks', () => {
    spawnMock.mockReturnValue(ok('a.ts\n\n b.ts \n'));
    expect(getChangedFiles()).toEqual(['a.ts', 'b.ts']);
  });

  // #820: `--all` is supposed to mean the whole tree, and the runner already
  // exports that decision as GATE_SCOPE (gate-runner.js builds
  // `GATE_SCOPE="all"`). The shell fragments were taught to read it in #589 and
  // #616; these TS implementations kept calling `git diff --cached`, so on a
  // clean index they scanned NOTHING and reported the tree clean. Measured on
  // llmveto with ~60 tracked .ts files: `xp-gate check --all` SKIPped SAST with
  // "no supported language files changed" while semgrep over the same src/
  // returned 5 findings.
  describe('getChangedFiles honours GATE_SCOPE (#820)', () => {
    const original = process.env.GATE_SCOPE;
    afterEach(() => {
      if (original === undefined) delete process.env.GATE_SCOPE;
      else process.env.GATE_SCOPE = original;
    });

    it('GATE_SCOPE=all enumerates tracked files instead of the index', () => {
      process.env.GATE_SCOPE = 'all';
      spawnMock.mockReturnValue(ok('src/a.ts\nsrc/b.ts\n'));
      expect(getChangedFiles()).toEqual(['src/a.ts', 'src/b.ts']);
      // The command must be `ls-files`, not `diff --cached`.
      const args = spawnMock.mock.calls.at(-1)?.[1] as string[];
      expect(args).toContain('ls-files');
      expect(args).not.toContain('--cached');
    });

    it('the default (diff) path is byte-identical to before', () => {
      delete process.env.GATE_SCOPE;
      spawnMock.mockReturnValue(ok('a.ts\n'));
      getChangedFiles();
      const args = spawnMock.mock.calls.at(-1)?.[1] as string[];
      expect(args).toEqual(['diff', '--cached', '--name-only', '--diff-filter=ACM']);
    });

    it('GATE_SCOPE values other than "all" keep the index form', () => {
      process.env.GATE_SCOPE = 'diff';
      spawnMock.mockReturnValue(ok('a.ts\n'));
      getChangedFiles();
      const args = spawnMock.mock.calls.at(-1)?.[1] as string[];
      expect(args).toContain('--cached');
    });
  });

  it('getChangedFiles returns empty list when git fails', () => {
    spawnMock.mockReturnValue(fail());
    expect(getChangedFiles()).toEqual([]);
  });

  it('detectPowerShell probes candidates in order and reports version', () => {
    spawnMock
      .mockReturnValueOnce(fail()) // where pwsh
      .mockReturnValueOnce(ok('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\n')) // where powershell.exe
      .mockReturnValueOnce(ok('5.1.0\n')); // version probe
    const info = detectPowerShell();
    expect(info.available).toBe(true);
    expect(info.version).toBe('5.1.0');
  });

  it('detectPowerShell reports unavailable when nothing answers', () => {
    spawnMock.mockReturnValue(fail());
    expect(detectPowerShell().available).toBe(false);
  });
});
