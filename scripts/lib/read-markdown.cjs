'use strict';
const fs = require('fs');

/**
 * Read a markdown file with line endings normalized to LF.
 *
 * Regression tests that extract JSON examples by matching "```json\n" must not
 * depend on the checkout's core.autocrlf setting: on Windows the working tree
 * holds CRLF and bare-\n patterns never match, reporting doc drift that does
 * not exist (#425).
 *
 * Declared scope: CRLF only. The sole writer of these files is a git checkout,
 * which emits LF or CRLF and never a lone CR (a CR inside a *path* is quoted as
 * \215 instead of passed through), so a bare-CR branch here would be untested
 * code rather than a fix.
 */
function readMarkdown(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

module.exports = { readMarkdown };
