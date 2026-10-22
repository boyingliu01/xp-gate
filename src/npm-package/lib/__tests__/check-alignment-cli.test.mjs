/**
 * @test check-alignment CLI
 * @intent Guard the #392-#6 injection fix and the zero-install fallback path:
 *         (1) no spawn/exec call in bin/xp-gate.js may enable a shell (which on
 *         win32 would let cmd.exe interpret metacharacters embedded in
 *         user-supplied paths); (2) the published runner emits a complete,
 *         parseable --json document instead of truncating it on process.exit().
 * @covers AC-392-06 (injection), zero-install contract (fallback)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', '..', 'bin', 'xp-gate.js');
const RUNNER = join(here, '..', 'check-alignment-runner.cjs');

describe('check-alignment CLI injection surface (#392-#6)', () => {
  it('bin/xp-gate.js rejects shell metacharacters before any launch', () => {
    const src = readFileSync(BIN, 'utf8');
    // The injection guard must be in front of every subprocess launch: any
    // argument carrying a cmd.exe metacharacter is refused outright, never
    // escaped, before a shell can see it (#392-#6, Delphi R1-C). This holds on
    // both platforms -- on win32 a .cmd wrapper needs cmd.exe (EINVAL without
    // one), so the metachar guard is the only thing that makes shelling safe.
    expect(src).toMatch(/CMD_METACHAR_RE/);
    expect(src).toMatch(/firstUnsafeArg/);
    // The metachar class must cover the cmd.exe separators/redirection.
    expect(src).toMatch(/CMD_METACHAR_RE\s*=.*[&|^<>%!]/);
    // Any shell a launcher may engage must be gated on the metachar rejection
    // having run first, and never enabled unconditionally on win32. The single
    // sanctioned engagement is the named SHELL_ON_WINDOWS_ONLY constant.
    expect(src).not.toMatch(/shell\s*:\s*(?:true|process\.platform)/);
    expect(src).toMatch(/shell:\s*SHELL_ON_WINDOWS_ONLY/);
    // execSync interpolates argv into a command string via a shell, so it is
    // banned; execFileSync is fine only for hardcoded binaries with non-user
    // argv (git rev-parse HEAD). The launchers below are the user-input path.
    expect(src).not.toMatch(/\bexecSync\s*\(/);
  });

  it('a metacharacter path is refused end to end before any launch (MJ-02)', () => {
    // Behavioral, not shape: invoke the real CLI with a --spec whose path
    // carries a cmd metacharacter and assert the documented refusal — exit 1
    // plus the "refusing" message, never a spawned engine.
    const evil = join(here, 'evil&echo.spec.yaml');
    const result = spawnSync(process.execPath, [BIN, 'check-alignment', '--spec', evil, '--json'], {
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(result.status).toBe(1);
    expect(`${result.stderr}${result.stdout}`).toMatch(/metacharacter|refus/i);
  }, 90000);
});

describe('check-alignment runner output integrity', () => {
  it('emits a complete parseable JSON document with --json', () => {
    const spec = join(here, 'test-alignment.test.ts');
    // Run the runner under the SAME loader the CLI uses. `check-alignment-runner.cjs`
    // does `require('./test-alignment.ts')`, and plain `node` only tolerates that
    // from Node 22.6+ (type stripping). CI pins Node 20.x, where it throws
    // "Unknown file extension" — the runner printed nothing, and the empty string
    // surfaced as "Unexpected end of JSON input", which reads exactly like the
    // truncation this test guards against (#586). bin/xp-gate.js has always loaded
    // this file through tsx; the test was the only caller that did not.
    const result = spawnSync(
      process.execPath,
      [join(here, '..', '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), RUNNER, '--spec', spec, '--json'],
      { encoding: 'utf8' }
    );
    expect(result.error).toBeUndefined();
    // An EMPTY stdout also parses to "Unexpected end of JSON input", which is
    // indistinguishable from the truncation this test exists for. Report what the
    // runner actually did first, so a crash is not mistaken for a truncation.
    expect(
      result.stdout,
      `runner produced no stdout at all (status=${result.status}, ` +
        `stderr=${JSON.stringify(result.stderr)}) — that is a crash, not a truncation`
    ).not.toBe('');
    // The whole stdout stream must be one valid JSON document. A process.exit()
    // immediately after console.log would truncate it on some platforms.
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('alignment_status');
    expect(parsed).toHaveProperty('score');
    expect(parsed).toHaveProperty('head_commit');
  });

  it('fails fast with exit code 1 when --spec is missing', () => {
    const result = spawnSync(process.execPath, [RUNNER], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--spec <path> is required');
  });
});
