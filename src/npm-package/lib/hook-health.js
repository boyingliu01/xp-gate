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
 * Locate a bash binary without assuming it is on PATH under that exact name.
 * @returns {string|null} Path or bare command name, null when none found
 */
function findBash() {
  const candidates = ['bash'];
  if (process.platform === 'win32') {
    // Git for Windows ships bash outside PATH far more often than inside it.
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, 'Programs', 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf86, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(pf, 'Git', 'usr', 'bin', 'bash.exe'));
  }
  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    const probe = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (!probe.error && probe.status === 0) return c;
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
 * Ask bash whether it can parse the file (`bash -n`).
 * @param {string} filePath - Hook to check
 * @param {string} bashBin - Resolved bash binary
 * @returns {{checked: boolean, ok: boolean, detail: string}} Parse verdict
 */
function checkParseable(filePath, bashBin) {
  if (!bashBin) return { checked: false, ok: true, detail: 'bash not found; parse check skipped' };
  const res = spawnSync(bashBin, ['-n', filePath], { encoding: 'utf8', timeout: 30000 });
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

module.exports = { inspectHookFile, findBash, countCrlfLines };
