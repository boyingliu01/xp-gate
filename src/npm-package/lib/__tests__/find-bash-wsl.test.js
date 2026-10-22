/**
 * @test REQ-570 findBash must reject a WSL bash and prefer Git for Windows
 * @intent `findBash()` puts the bare name `bash` first in its candidate list, and
 *         accepts whatever PATH resolves it to as long as `bash --version` exits
 *         0. On a machine with WSL installed, `bash` on PATH IS WSL:
 *
 *             > (Get-Command bash -All).Source
 *             C:\WINDOWS\system32\bash.exe
 *             C:\Users\think\AppData\Local\Microsoft\WindowsApps\bash.exe
 *             > bash -c "uname -s"
 *             Linux
 *             > bash --version ; echo $LASTEXITCODE
 *             GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)
 *             (exit 0)
 *
 *         Exit code 0 is exactly the probe's acceptance condition, so `findBash`
 *         returns the string `"bash"` — WSL — and every subsequent `bash -n
 *         <windows path>` fails with "No such file or directory", because a
 *         Linux bash cannot open `C:/...`. That is where doctor's "hook is not
 *         parseable" came from.
 *
 *         This corrupts my own audit trail, so it is worth stating plainly: in
 *         issue #563 I wrote that the §2.2 WSL-stub false positive "does not
 *         reproduce" and downgraded it to robustness debt. I had measured
 *         `where bash` (which lists the WSL stubs) and the stubs' `--version`
 *         (status null / 1 with UTF-16 garbage) and concluded the probe already
 *         rejected them. Both measurements were about DIFFERENT bash binaries
 *         than the one `findBash` actually reaches: `spawnSync('bash', ...)`
 *         from Node resolves through PATH the same way the shell does, and here
 *         that reaches a healthy WSL bash which exits 0. The finding was real;
 *         the retraction was wrong.
 *
 *         Related: the POSIX-path conversion in #565 is still correct and still
 *         needed — Git bash accepts `C:/...` while a backslash path gets eaten by
 *         escape processing. But with the wrong bash selected, no path form
 *         works, which is why #565 alone did not fix doctor.
 * @covers AC-570-01, AC-570-02, AC-570-03
 */
const path = require('path');

const { findBash } = require('../hook-health');

/** Windows-only: every assertion here is about Windows bash selection. */
const itWin = process.platform === 'win32' ? test : test.skip;

/**
 * Run `bash -s` against a command and return trimmed stdout.
 * @param {string} bashPath - binary to interrogate
 * @param {string} script - shell snippet
 * @returns {{status: number|null, out: string}} result
 */
function runBash(bashPath, script) {
  const { spawnSync } = require('child_process');
  const res = spawnSync(bashPath, ['-c', script], { encoding: 'utf8', timeout: 20000 });
  return { status: res.status, out: String(res.stdout || '').trim() };
}

describe('findBash platform selection', () => {
  itWin('AC-570-01: the resolved bash is a Windows bash, not WSL', () => {
    const bin = findBash();

    expect(bin, 'findBash returned nothing; every hook-health probe is skipped').not.toBeNull();

    // `uname -s` is the discriminator the project already uses elsewhere
    // (detect-deps.resolveWindowsBashCandidates): Git bash reports MINGW*/MSYS*/
    // CYGWIN*, WSL reports Linux.
    const { out } = runBash(bin, 'uname -s');
    expect(out, `findBash() selected "${bin}" which reports uname -s = "${out}"`).toMatch(
      /MINGW|MSYS|CYGWIN/i
    );
  });

  itWin('AC-570-02: a WSL bash on PATH does not win over Git for Windows', () => {
    // The defect, stated as a property rather than as a specific fix: whatever
    // PATH offers first, a Git for Windows bash exists on this machine (the
    // whole test suite only runs because it does), so findBash must reach it.
    const gitBash = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Git',
      'bin',
      'bash.exe'
    );

    const bin = findBash();

    if (require('fs').existsSync(gitBash)) {
      expect(
        path.resolve(bin),
        'a Git for Windows bash is installed but findBash picked something else'
      ).toBe(path.resolve(gitBash));
    } else {
      // No Git bash here: the WSL bash would still be wrong, so requiring a
      // MINGW report is the honest fallback rather than accepting "bash".
      expect(runBash(bin, 'uname -s').out).toMatch(/MINGW|MSYS|CYGWIN/i);
    }
  });

  itWin('AC-570-03: the selected bash can actually open a Windows hook path', () => {
    // End to end, and the reason any of this matters: the probe that doctor runs
    // is `bash -n <path>`, so the selected binary must be able to see a Windows
    // file at all. This is the assertion that would have caught #563's
    // retraction being wrong.
    const fs = require('fs');
    const os = require('os');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findbash-probe-'));
    const hook = path.join(dir, 'pre-commit');
    try {
      fs.writeFileSync(hook, '#!/bin/bash\necho hi\n');
      const bin = findBash();
      const posix = hook.replace(/\\/g, '/');

      // Both forms are tried: a correct bash accepts both on Windows, so this
      // asserts the binary, not the path convention (that is #565's subject).
      expect(runBash(bin, `bash -n '${posix}' && echo PARSE_OK`).out).toContain('PARSE_OK');
      expect(runBash(bin, `bash -n '${hook}' && echo PARSE_OK`).out).toContain('PARSE_OK');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
