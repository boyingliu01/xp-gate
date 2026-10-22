/**
 * @test REQ-566 hook parse check must survive a Windows path
 * @intent `checkParseable()` ran `spawnSync(bashBin, ['-n', filePath])` with the
 *         native Windows path. Git bash interprets a backslash in an argument as
 *         an escape, so `C:\Users\think\.config\xp-gate\hooks\pre-push` reached
 *         bash as `C:Usersthink.configxp-gatehookspre-push` and every hook above
 *         the size floor was reported "not parseable".
 *
 *         Reproduced on this machine against the real installed hook:
 *
 *             findBash()  -> "C:\\Program Files\\Git\\bin\\bash.exe"
 *             hook path   -> "C:\\Users\\think\\.config\\xp-gate\\hooks\\pre-push"
 *             verdict     -> "hook is not parseable by bash:
 *                             /bin/bash: C:Usersthink\\.config\\xp-gate\\hooks\\pre-push:
 *                             No such file or directory"
 *
 *         while `bash -n` on the same file from Git bash reports PARSE_OK. Note
 *         the mangled basename still shows its separators in some positions —
 *         the collapse is per-escape, which is why this looked like a missing
 *         file rather than a path bug for so long.
 *
 *         `xp-gate doctor` therefore FAILed on a perfectly healthy hook, and the
 *         failure text named a path that does not exist, sending the operator to
 *         look for a missing file.
 * @covers AC-566-01, AC-566-02, AC-566-03
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { inspectHookFile, toPosixPath } = require('../hook-health');

let TMP;

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-posix-'));
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Write a hook file large enough to clear the parse-check size floor.
 * @param {string} name - file name
 * @param {string} body - shell source
 * @returns {string} absolute path
 */
function writeHook(name, body) {
  const abs = path.join(TMP, name);
  try {
    // Padding keeps the file above PARSE_CHECK_MIN_BYTES so the probe actually
    // runs; a stub below the floor would make every assertion here vacuous.
    fs.writeFileSync(abs, body + '# ' + 'x'.repeat(8192) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fixture setup failed writing ${name}: ${msg}`);
  }
  return abs;
}

describe('bash -n path handling', () => {
  test('AC-566-01: toPosixPath converts a Windows path without mangling it', () => {
    // The transform under test, isolated: drive letter preserved, separators
    // flipped, no characters dropped.
    expect(toPosixPath('C:\\Users\\think\\.config\\xp-gate\\hooks\\pre-push')).toBe(
      'C:/Users/think/.config/xp-gate/hooks/pre-push'
    );
    // A POSIX path is already correct and must not be doubled over.
    expect(toPosixPath('/home/user/.config/xp-gate/hooks/pre-push')).toBe(
      '/home/user/.config/xp-gate/hooks/pre-push'
    );
  });

  // Windows-only by construction: the assertion below requires path.join to
  // produce a backslash path (`C:\...`), which only happens on win32. On Linux
  // path.join yields `/tmp/...` and the test fails with
  //   expected '/tmp/hook-posix-XiaI9b/pre-push' to contain '\'
  // That is a platform premise, not a regression (#586). Skipping keeps the gap
  // visible in the run summary instead of painting CI red on every build.
  const onWindows = process.platform === 'win32';

  test.skipIf(!onWindows)('AC-566-02: a healthy hook under a native Windows path is parseable', () => {
    // The defect, end to end. The path MUST come from path.join, not from a
    // string literal: path.join produces the single-backslash form that Node
    // hands to spawnSync, and that is the form bash mangles. A hand-written
    // fixture path with different escaping would pass before the fix and make
    // this test vacuous — measured, not assumed.
    const hook = writeHook('pre-push', '#!/bin/bash\nset -e\necho hi\n');
    expect(hook).toContain('\\'); // the path really is the Windows form

    const verdict = inspectHookFile(hook, {});

    expect(verdict.problems.join('; ')).not.toMatch(/No such file or directory/);
    expect(verdict.parseable, 'a syntactically valid hook must parse').toBe(true);
    expect(verdict.ok, 'a healthy hook must not be reported as broken').toBe(true);
  });

  test('AC-566-03: a genuinely broken hook is still reported as broken', () => {
    // Guards against "fix it by never failing": path handling must not turn the
    // probe into a no-op. This is the anti-vacuity half of AC-566-02.
    const hook = writeHook('pre-commit', '#!/bin/bash\nif [ 1 -eq 1 ]; then\n  echo hi\n');

    const verdict = inspectHookFile(hook, {});

    expect(verdict.parseable, 'an unterminated if must fail the parse').toBe(false);
    expect(verdict.ok).toBe(false);
  });
});
