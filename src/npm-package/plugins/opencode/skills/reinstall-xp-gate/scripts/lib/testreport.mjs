/**
 * Read the failure count out of Node's test-runner output.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * Node picks its reporter by whether stdout is a TTY:
 *
 *   local terminal   ℹ tests 92 / ℹ pass 92 / ℹ fail 0      (spec)
 *   CI (piped)       # tests 92 / # pass 92 / # fail 0      (TAP)
 *
 * A regex matching only the spec spelling made every CI run of the mutation
 * gate report "the runner failed", because it was looking for the wrong
 * spelling of a line that was right there. The same mistake would make a
 * genuinely broken run look merely unreadable, or vice versa, so the parse is
 * isolated here and tested against both formats instead of being buried in the
 * runner.
 */

/**
 * @param {string} output combined stdout+stderr of a `node --test` run
 * @returns {number} failing test count, or -1 when no count could be read
 */
export function parseFailCount(output) {
  const match = String(output).match(/(?:\u2139 fail|# fail) (\d+)/);
  return match ? Number(match[1]) : -1;
}
