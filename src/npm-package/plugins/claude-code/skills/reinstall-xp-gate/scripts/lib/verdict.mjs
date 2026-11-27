/**
 * Interpret xp-gate gate output as a single verdict.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * `verdictOf` is the only thing between a gate's raw text and the audit's
 * conclusion, so it has two failure modes that both look like a healthy report:
 * reading a clean run as broken (the audit cries wolf and stops being read), and
 * reading a broken run as clean (the audit certifies a dead gate). It lives
 * alone so `tests/verdict.test.mjs` can pin every marker without loading the
 * module that spawns git and xp-gate.
 *
 * `detected` is deliberately not `blocked`: the gates are not uniform about
 * severity. Gate 8 exits 1 on a secret, while Gate 2 reports "Found N clones"
 * and still exits 0. Collapsing them would either call Gate 2 broken or call a
 * non-blocking gate a blocker, and a case says which one it expects.
 */

/** @returns {'blocked'|'detected'|'passed'|'skipped'|'unknown'} */
export function verdictOf(output) {
  const text = String(output || '');
  if (/⏭️|SKIPPED/i.test(text)) return 'skipped';
  // FAILED must be a standalone token, not a substring. A path like
  // ./failed-tests.js or a rule id containing "failed" would otherwise turn a
  // clean run into a false alarm -- and a false alarm is how an audit stops
  // being read at all.
  if (/❌|BLOCKED|\bFAILED\b/.test(text)) return 'blocked';
  return passedOrDetected(text);
}

/**
 * The non-failure verdicts, in the order they must be tried.
 *
 * "Found 0 clones." is a clean pass, but Gate 2 prints no ✅ marker at all, so a
 * marker-only parser reports 'unknown' for a perfectly good run -- and a case
 * that "cannot be read" is indistinguishable from one that broke.
 */
function passedOrDetected(text) {
  if (/Found 0 clones/i.test(text)) return 'passed';
  // "Found 1 clones." / "Clone found" -- the gate saw duplication but does not
  // fail the build for it (measured: exit 0 with and without clones).
  if (/Found \d+ clones?\.|Clone found/i.test(text)) return 'detected';
  if (/✅|PASSED/i.test(text)) return 'passed';
  return 'unknown';
}
