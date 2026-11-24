'use strict';
/**
 * How one audited tool is shown: its status word, its glyph, and its qualifiers.
 *
 * Split out of `language-tools.js` when that file crossed its line ceiling. The
 * behaviour moved unchanged -- these are pure readers of a row -- and the reasons
 * they exist moved with them.
 */

/**
 * Handle check-tools CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
/**
 * Render one audit row as the status the CLI contract uses.
 *
 * A row is unusable for two different reasons and they must not be merged:
 * the probe failed (missing/broken), or the probe could not be interpreted.
 * Both are "not usable", but only the first is "not installed".
 */
function statusOfRow(row) {
  return row.available ? 'available' : 'missing';
}

/** Icon for a row: present, present-but-flagged, or absent. */
function iconOfRow(row) {
  if (!row.available) return '✗';
  if (row.duplicated || row.outdated) return '⚠';
  return '✓';
}

/** Extra qualifiers appended to a human line, e.g. "duplicate ×2, 2.14.0 → 2.15.1". */
function qualifiersOfRow(row) {
  const parts = [];
  if (row.duplicated) parts.push(`DUPLICATE ×${row.distinctRealPaths.length}`);
  if (row.outdated && row.installedVersion && row.latestVersion) {
    parts.push(`${row.installedVersion} → ${row.latestVersion} available`);
  } else if (row.currency === 'unknown') {
    parts.push('version currency unknown');
  }
  // #843: say WHERE the binary was found. "Installed but not on PATH" and
  // "not installed" look identical in a pass/fail column and call for opposite
  // actions -- add it to PATH (or symlink it), versus install it.
  if (row.available && row.resolution === 'fallback' && row.resolvedPath) {
    parts.push(`found at ${row.resolvedPath} (not on PATH)`);
  }
  if (!row.available && row.validityReason) parts.push(row.validityReason);
  return parts.join('; ');
}

module.exports = { statusOfRow, iconOfRow, qualifiersOfRow };
