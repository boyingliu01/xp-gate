/**
 * Classify Boy Scout / principles debt by whether it is worth fixing (#638).
 *
 * The tracker reported Gate 6 as "139 warnings / 14 files — clearable". Measured,
 * those warnings are not one kind of problem:
 *
 *   magic-numbers            122   INFO — `.principlesrc` sets severity=info, so it
 *                                  never blocks. Almost unavoidable in tests
 *                                  (timeouts, ports, status codes) and deliberately
 *                                  not worth forcing people to edit.
 *   missing-error-handling    79   actionable
 *   long-function             27   actionable
 *   deep-nesting              22   actionable
 *   solid.* + misc            11   actionable
 *
 * Mixing them makes the headline number un-actionable: clearing every
 * missing-error-handling drops the total from 139 to 60, which reads like 57% done
 * when the most valuable category is actually empty. A number that cannot express
 * progress cannot direct work.
 *
 * So this module splits debt into "actionable" and "informational", and keeps the
 * actionable rules separate because each is a different job — add a try/catch, split
 * a function, flatten nesting, split a class.
 */
'use strict';

/**
 * Rules whose configured severity is `info`.
 *
 * These still appear in analyzer output, but `.principlesrc` marks them info
 * precisely so they never block. Listing them as debt would make the debt number
 * permanently non-zero.
 */
const INFO_ONLY_RULES = [
  'clean-code.magic-numbers',
  'clean-code.unused-imports',
  'clean-code.many-exports',
  'solid.ocp',
];

function isInformational(rule) {
  return INFO_ONLY_RULES.includes(rule);
}

/**
 * Annotate individual findings with `fixability`.
 *
 * Unknown rules default to `actionable` on purpose. A new analyzer rule that this
 * module has not heard of must not silently become noise — over-reporting work is
 * recoverable, under-reporting debt is the failure mode that lets real problems hide
 * behind a green dashboard.
 *
 * @param {Array<{file: string, rule: string}>} findings
 * @returns {Array<{file: string, rule: string, fixability: 'actionable'|'informational'}>}
 */
function classifyDebt(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.map((f) => ({
    ...f,
    fixability: isInformational(f.rule) ? 'informational' : 'actionable',
  }));
}

/**
 * Totals per fixability class, plus a per-rule breakdown of the actionable part.
 *
 * @param {Array<{file: string, rule: string, count?: number}>} rows
 * @returns {{actionable: number, informational: number, byRule: Record<string, number>}}
 */
function summarizeDebtByFixability(rows) {
  const byRule = {};
  let actionable = 0;
  let informational = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const count = typeof row.count === 'number' ? row.count : 1;
    if (isInformational(row.rule)) {
      informational += count;
      continue;
    }
    actionable += count;
    byRule[row.rule] = (byRule[row.rule] || 0) + count;
  }
  return { actionable, informational, byRule };
}

module.exports = { classifyDebt, summarizeDebtByFixability, INFO_ONLY_RULES, isInformational };
