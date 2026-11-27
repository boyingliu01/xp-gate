/**
 * Guard rails for a lizard measurement.
 *
 * Both exist because a WRONG number is worse than a missing one: an empty result read as
 * "no functions" drops a file from the baseline, and a truncated one drops every function
 * lizard had not reached yet. Either way the ratchet silently stops protecting code
 * nobody measured.
 */

const fs = require('fs');
const path = require('path');

/** Whether this path is a readable regular file. */
function isReadableFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Throw unless an EMPTY result really means "zero functions here".
 *
 * lizard exits ZERO and prints NOTHING for a path it cannot read (measured:
 * `lizard --csv /nope/zzz.js`), so empty output alone cannot mean "no functions" --
 * that reading silently drops an unmeasurable file from the baseline and the ratchet.
 * The exit status is not a usable signal either, so the file is confirmed readable.
 */
function requireEmptyOutputIsReal({ err, root, relPath, withStderr }) {
  if (err) {
    throw new Error(`no measurable output for ${relPath} (lizard exited ${err.code || 'with an error'})${withStderr}`);
  }
  if (!isReadableFile(path.join(root, relPath))) {
    throw new Error(`lizard reported nothing for ${relPath}, which is not a readable file — treating as measurement failure, not a zero-function file`);
  }
}

/**
 * Throw when lizard was killed mid-write.
 *
 * Partial output alongside a hard failure (a timeout or a kill) is a TRUNCATED
 * measurement, not a result. lizard's documented non-zero exits for warnings come with
 * COMPLETE output, so a kill or timeout signal is the signal to distrust the rows:
 * accepting them would silently drop every function lizard had not reached yet.
 */
function requireNotTruncated({ err, relPath }) {
  if (!err) return;
  // `ETIMEDOUT` is checked explicitly. Measured with `spawnSync(..., { timeout })`:
  // `signal` is set to SIGTERM but `killed` is UNDEFINED, so a guard written against
  // `killed` alone would miss a timeout entirely. `signal` happens to cover this case,
  // and naming the code keeps it covered if Node ever stops sending the signal (review
  // FC-02).
  const timedOut = err.code === 'ETIMEDOUT';
  if (!err.killed && !err.signal && !timedOut) return;
  throw new Error(`lizard was killed while measuring ${relPath} (${err.signal || err.code || 'timeout'}); output is truncated`);
}

module.exports = { requireEmptyOutputIsReal, requireNotTruncated };
