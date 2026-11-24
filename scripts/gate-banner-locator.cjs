'use strict';
/**
 * Locating gate sections inside the hook file.
 *
 * Three scripts -- `analyse-hook-structure`, `reorder-gates` and `extract-gates` --
 * each carried their own copy of this: the same banner regex, the same
 * "is this line a gate title" test, the same seven-line look-ahead, and the same
 * `keyOf` derivation. They must agree about where each gate starts, because
 * `reorder-gates` rewrites what `extract-gates` reads and
 * `analyse-hook-structure` verifies by. Three copies of one rule is three chances
 * for the reorder to disagree with the reader about a gate's extent.
 */

/** A gate's section opens with a rule of `=` signs. */
const BANNER = /^# ={20,}\s*$/;

/**
 * How far past a banner to look for the gate's title line.
 *
 * The title is the first `#`-prefixed line after the rule; a non-comment line ends
 * the search, because it means the rule was not a section banner at all.
 */
const TITLE_LOOKAHEAD = 8;

/** Whether a line names a gate, in either of the two spellings the file uses. */
const isGateBannerText = (t) => /^# GATE ?\d+[a-c]?:/i.test(t) || /^# Gate 1[2][a-c]?:/i.test(t);

/**
 * The gate key a title line names, or null.
 *
 * Gate 13 and the 12a/12b/12c splits are why this is not a single regex: the file
 * spells the numbered gates as `# GATE 3:` and the late ones as `# Gate 12a:`, and
 * both spellings map to the same key space the driver uses.
 *
 * @param {string} title
 * @returns {string|null} e.g. '3', '12a', '13'
 */
function keyOf(title) {
  const numbered = title.match(/^# GATE ?(\d+)([a-c]?):/i);
  if (numbered) return numbered[2] ? numbered[1] + numbered[2] : numbered[1];
  const late = title.match(/^# Gate 12([a-c]?):/i);
  if (late) return late[1] ? `12${late[1]}` : '12';
  return null;
}

/**
 * Every gate banner in `lines`, in file order.
 *
 * @param {string[]} lines the hook file, or the region of it to scan
 * @returns {Array<{banner: number, text: string}>} `banner` is the rule's index
 */
function findGateBanners(lines) {
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!BANNER.test(lines[i])) continue;
    const title = titleAfterBanner(lines, i);
    if (title) starts.push({ banner: i, text: title });
  }
  return starts;
}

/**
 * The gate title following the rule at `banner`, or null.
 *
 * @param {string[]} lines
 * @param {number} banner index of the rule
 * @returns {string|null}
 */
function titleAfterBanner(lines, banner) {
  const limit = Math.min(banner + TITLE_LOOKAHEAD, lines.length);
  for (let j = banner + 1; j < limit; j++) {
    if (isGateBannerText(lines[j])) return lines[j].trim();
    // A non-comment line means the rule opened something other than a gate section.
    if (!/^#/.test(lines[j])) break;
  }
  return null;
}

module.exports = { BANNER, isGateBannerText, keyOf, findGateBanners };
