'use strict';
const fs = require('fs');

/**
 * Read a markdown file with line endings normalized to LF.
 *
 * Regression tests that extract JSON examples by matching "```json\n" must not
 * depend on the checkout's core.autocrlf setting: on Windows the working tree
 * holds CRLF and bare-\n patterns never match, reporting doc drift that does
 * not exist (#425).
 */
function readMarkdown(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

module.exports = { readMarkdown };
