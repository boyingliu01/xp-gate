'use strict';
/**
 * How a sprint's status and durations are rendered.
 *
 * These lived TWICE -- once in `phase-transition.js` and once in `sprint-status.js`
 * -- and the two copies had already diverged:
 *
 *   statusIcon      the phase-transition copy knows `failed` and `paused`; the
 *                   sprint-status copy falls through to the "pending" glyph for
 *                   both, so a failed phase rendered as pending.
 *   formatDuration  the two disagreed on the EMPTY marker and on anything past 24h:
 *                   `-` versus ``, and `2d 3h` versus `51h 0m`.
 *
 * Two renderings of the same fact is the failure this module ends: one
 * implementation, and the difference that is genuinely contextual (a table cell
 * needs a placeholder, a list row does not) expressed as an ARGUMENT rather than
 * as a second copy.
 */

/** Seconds in a minute, hour and day, named so the arithmetic reads. */
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * The status glyph for one phase or sprint row.
 *
 * A lookup, not a switch: six cases is six branches to the complexity metric, and a
 * table says the same thing without any. `PENDING_GLYPH` is the fallback for a status
 * this release does not know -- deliberately not a success glyph, because an unknown
 * state is not a good one.
 */
const STATUS_GLYPHS = {
  completed: '✅',
  in_progress: '🔄',
  skipped: '⏭️',
  failed: '❌',
  paused: '⏸️',
};
const PENDING_GLYPH = '⏳';

function statusIcon(status) {
  return STATUS_GLYPHS[status] || PENDING_GLYPH;
}

/**
 * The unit ladder, smallest first.
 *
 * `divisor` converts seconds to that unit; `remainer` names what the next-smaller
 * component is (minutes within an hour, hours within a day). A unit whose remainder
 * is 0 is not shown -- "2h 0m" is noise the reader has to filter.
 */
const DURATION_UNITS = [
  { divisor: 1, label: 's', remainder: 0, remainderDivisor: 1 },
  { divisor: SECONDS_PER_MINUTE, label: 'm', remainder: 0, remainderDivisor: 1 },
  { divisor: SECONDS_PER_MINUTE * MINUTES_PER_HOUR, label: 'h', remainder: 'm', remainderDivisor: SECONDS_PER_MINUTE },
  { divisor: SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY, label: 'd', remainder: 'h', remainderDivisor: SECONDS_PER_MINUTE * MINUTES_PER_HOUR },
];

/**
 * Pick the largest unit that fits, and its remainder.
 *
 * @param {number} seconds positive
 * @returns {{value: number, label: string, remainder: number, remainderLabel: string}}
 */
function pickUnit(seconds) {
  const unit = DURATION_UNITS.reduce(
    (chosen, candidate) => (seconds >= candidate.divisor ? candidate : chosen),
    DURATION_UNITS[0],
  );
  const remainder = unit.remainder
    ? Math.floor(seconds / unit.remainderDivisor) % (unit.divisor / unit.remainderDivisor)
    : 0;
  return { value: Math.floor(seconds / unit.divisor), label: unit.label, remainder, remainderLabel: unit.remainder };
}

/**
 * A duration in seconds as the largest sensible unit.
 *
 * Seconds are the only unit below a minute, so 59 s reads "59s" and not "0m". Past a
 * day the unit is days, because "51h 0m" makes the reader do arithmetic the dashboard
 * exists to save.
 *
 * @param {number|null|undefined} seconds
 * @param {{empty?: string}} [options] what an unmeasured duration renders as. A TABLE
 *   cell needs a placeholder so the column keeps its width; a list row wants nothing
 *   at all. Both are legitimate, which is why this is a parameter and not a fork.
 * @returns {string}
 */
function formatDuration(seconds, options = {}) {
  const empty = options.empty === undefined ? '' : options.empty;
  if (seconds == null || seconds === 0) return empty;

  return renderUnit(pickUnit(seconds));
}

/**
 * Render a picked unit.
 *
 * A zero remainder is KEPT for hour and day units ("2h 0m"), not dropped: the
 * dashboard column relies on the width being stable, and dropping it makes rows of
 * the same table differ in length. My first version dropped it and two existing tests
 * caught the regression immediately.
 *
 * @param {{value: number, label: string, remainder: number, remainderLabel: string}} u
 * @returns {string}
 */
function renderUnit(u) {
  const head = `${u.value}${u.label}`;
  const tail = u.remainderLabel ? ` ${u.remainder}${u.remainderLabel}` : '';
  return `${head}${tail}`;
}

module.exports = { statusIcon, formatDuration };
