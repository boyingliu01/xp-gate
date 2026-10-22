/**
 * Hook file health inspection (#546).
 *
 * `xp-gate doctor` used to answer one question about an installed hook: does the
 * file exist and does it carry the xp-gate signature. A hook can satisfy both
 * and still be unrunnable — #546 was a pre-commit that had been rewritten with
 * CRLF line endings, which fails every commit while doctor reported ✓.
 *
 * Two independent failure modes are checked here:
 *   - CRLF line endings: git runs hooks through bash, and a stray \r makes the
 *     parser choke at a line number far from the real cause (the reported line
 *     is wherever the multi-line construct that swallowed the \r began).
 *   - Unparseable syntax: a truncated or mangled write leaves a hook that
 *     exists but cannot run.
 *
 * Both are reported per file rather than as a single boolean, because the
 * operator needs to know which one happened: CRLF has a mechanical fix, a
 * syntax error does not.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Ask a bash binary whether it is a Windows bash rather than WSL.
 *
 * `bash --version` is not enough: a healthy WSL bash exits 0 for it. The
 * discriminator is the kernel it reports — Git for Windows builds report a
 * MINGW / MSYS / CYGWIN kernel name, WSL reports Linux. A Linux bash cannot
 * open `C:/...`, so selecting one turns every hook-health probe into "No such
 * file or directory" regardless of how the path is spelled.
 *
 * @param {string} bin - candidate binary
 * @returns {boolean} true when it is a Windows bash
 */
function isWindowsBash(bin) {
  const probe = spawnSync(bin, ['-c', 'uname -s'], { encoding: 'utf8', timeout: 10000 });
  if (probe.error || probe.status !== 0) return false;
  return /MINGW|MSYS|CYGWIN/i.test(String(probe.stdout || ''));
}

/**
 * Locate a bash binary without assuming it is on PATH under that exact name.
 *
 * On Windows the Git for Windows installs are probed FIRST and the bare name
 * `bash` is the last resort (#570). The previous order put `bash` first and
 * accepted any binary whose `--version` exited 0 — which is every healthy WSL
 * install. Measured on this machine: `bash` on PATH resolves to
 * `C:\WINDOWS\system32\bash.exe`, `uname -s` answers `Linux`, and the probe
 * `bash -n <windows path>` fails with "No such file or directory" no matter how
 * the path is spelled. `xp-gate doctor` then reported healthy hooks as
 * unparseable.
 *
 * @returns {string|null} Path or bare command name, null when none found
 */
function findBash() {
  const candidates = [];
  if (process.platform === 'win32') {
    // Git for Windows ships bash outside PATH far more often than inside it,
    // and PATH's `bash` is usually WSL.
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, 'Programs', 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf86, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf, 'Git', 'usr', 'bin', 'bash.exe'));
  }
  // Last resort: whatever PATH offers. On Windows it is only accepted when it
  // reports a Windows kernel, so a WSL stub can never be returned.
  candidates.push('bash');

  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    const probe = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (probe.error || probe.status !== 0) continue;
    if (process.platform === 'win32' && !isWindowsBash(c)) continue;
    return c;
  }
  return null;
}

/**
 * Count lines that end with CRLF.
 * @param {string} text - File content
 * @returns {number} Number of CRLF-terminated lines
 */
function countCrlfLines(text) {
  const matches = text.match(/\r\n/g);
  return matches ? matches.length : 0;
}

/**
 * Convert a native filesystem path to the form Git bash can open.
 *
 * A backslash inside an argument to MSYS bash is an ESCAPE character, so
 * `C:\Users\think\.config\xp-gate\hooks\pre-push` reaches bash as
 * `C:Usersthink.configxp-gatehookspre-push` and every candidate path looks
 * missing. Forward slashes are accepted by Windows APIs too, so this is the one
 * form that works on both sides.
 *
 * Exported because the transform is the thing being tested: asserting only
 * through `inspectHookFile` would leave the conversion itself unexamined.
 *
 * @param {string} p - native path
 * @returns {string} path with forward slashes
 */
function toPosixPath(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Ask bash whether it can parse the file (`bash -n`).
 * @param {string} filePath - Hook to check
 * @param {string} bashBin - Resolved bash binary
 * @returns {{checked: boolean, ok: boolean, detail: string}} Parse verdict
 */
function checkParseable(filePath, bashBin) {
  if (!bashBin) return { checked: false, ok: true, detail: 'bash not found; parse check skipped' };
  // Pass a POSIX path (#566). Git bash treats a backslash in its argv as an
  // escape, which silently collapsed every native Windows path into a
  // nonexistent one and reported healthy hooks as unparseable.
  const res = spawnSync(bashBin, ['-n', toPosixPath(filePath)], {
    encoding: 'utf8',
    timeout: 30000,
  });
  if (res.error) return { checked: false, ok: true, detail: `bash -n could not run: ${res.error.message}` };
  if (res.status === 0) return { checked: true, ok: true, detail: 'parses' };
  // bash reports the first syntax error it hits. Under CRLF that line number is
  // unreliable, which is exactly why the CRLF count is reported alongside.
  const firstLine = String(res.stderr || '').split('\n').find(l => l.trim()) || `exit ${res.status}`;
  return { checked: true, ok: false, detail: firstLine.trim() };
}

/**
 * Inspect one hook file for the conditions that make git unable to run it.
 * @param {string} filePath - Hook path
 * @param {{bashBin?: string|null, parseCheck?: boolean}} [options] - Overrides
 * @returns {{ok: boolean, crlfLines: number, parseable: boolean, problems: string[]}}
 */
function inspectHookFile(filePath, options = {}) {
  const problems = [];

  if (!fs.existsSync(filePath)) {
    return { ok: false, crlfLines: 0, parseable: false, problems: [`hook file is missing: ${filePath}`] };
  }

  let text = '';
  try {
    text = fs.readFileSync(filePath, 'latin1');
  } catch (err) {
    return { ok: false, crlfLines: 0, parseable: false, problems: [`hook file is unreadable: ${err.message}`] };
  }

  const crlfLines = countCrlfLines(text);
  if (crlfLines > 0) {
    problems.push(
      `hook has CRLF line endings (${crlfLines} line(s)) — bash will fail to parse it; ` +
        'run `tr -d "\\r" < hook > hook.fixed && mv hook.fixed hook`'
    );
  }

  // A CRLF hit already answers the question this probe exists to answer, and
  // the probe is the expensive half. Callers can also opt out for stubs.
  if (crlfLines > 0 || options.parseCheck === false) {
    return { ok: problems.length === 0, crlfLines, parseable: crlfLines === 0, problems };
  }

  const bashBin = options.bashBin !== undefined ? options.bashBin : findBash();
  const parsed = checkParseable(filePath, bashBin);
  if (!parsed.ok) {
    problems.push(`hook is not parseable by bash: ${parsed.detail}`);
  }

  return { ok: problems.length === 0, crlfLines, parseable: parsed.ok, problems };
}

module.exports = { inspectHookFile, findBash, countCrlfLines, toPosixPath };
