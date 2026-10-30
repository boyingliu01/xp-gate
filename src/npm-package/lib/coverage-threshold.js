/**
 * Coverage-threshold resolution with an explicit provenance field (#605).
 *
 * #605 asks for a single machine-readable test profile because thresholds are
 * scattered across 4+ files. Measured, the scattering is not the damaging part —
 * the damaging part is that the same concept has two live gates that read the same
 * number and disagree:
 *
 *   githooks/pre-commit   ${COVERAGE_THRESHOLD:-80}         flat 80%
 *   vitest.config.ts      lines 60 / statements 60
 *                         functions 81 / branches 79
 *
 * The vitest block documents itself as "the measured floor, not the 80% target",
 * so both are locally reasonable. The repo-wide consequence is that nobody can
 * answer "what coverage does this repo require" without reading two files.
 *
 * This module does not try to collapse every threshold into one file. It makes the
 * answer to that one question unique and explainable: given what each source
 * declares, produce (value, source, declared) and report a conflict rather than
 * silently preferring one side.
 *
 * The `declared` flag exists because of #561: `:-80` made "nobody declared a
 * threshold" and "someone declared 80" indistinguishable, so a doc claiming 80%
 * while the live config said 60% raised no alarm anywhere.
 */
'use strict';

/** What the hook assumes when no config declares a coverage floor. */
const IMPLICIT_COVERAGE_FLOOR = 80;

/**
 * Resolve the coverage floor from the sources that actually declare one.
 *
 * @param {object} [sources]
 * @param {{lines?: number, statements?: number, functions?: number, branches?: number}} [sources.vitest]
 * @param {number} [sources.preCommit]
 * @returns {{value: number, source: string, declared: boolean, conflict?: {hook: number, vitest: number, detail: string}}}
 */
function resolveCoverageThreshold(sources) {
  const src = sources || {};
  const vitestLines = src.vitest && typeof src.vitest.lines === 'number' ? src.vitest.lines : null;
  const hookValue = typeof src.preCommit === 'number' ? src.preCommit : null;

  const conflict = detectConflict(vitestLines, hookValue);

  if (vitestLines !== null) {
    return {
      value: vitestLines,
      source: 'vitest.config.ts',
      declared: true,
      ...(conflict ? { conflict } : {}),
    };
  }

  if (hookValue !== null) {
    return { value: hookValue, source: 'pre-commit', declared: true, ...(conflict ? { conflict } : {}) };
  }

  // Nothing declared: the hook's fallback applies. `declared: false` is the whole
  // point -- a caller must be able to tell "80 because someone chose 80" from
  // "80 because nobody said anything".
  return { value: IMPLICIT_COVERAGE_FLOOR, source: 'implicit', declared: false, ...(conflict ? { conflict } : {}) };
}

/**
 * Two live gates disagreeing about the same number is a defect, not a preference.
 * Reported, never resolved silently.
 */
function detectConflict(vitestLines, hookValue) {
  if (vitestLines === null || hookValue === null) return null;
  if (vitestLines === hookValue) return null;
  return {
    hook: hookValue,
    vitest: vitestLines,
    detail: `pre-commit enforces ${hookValue}% while vitest.config.ts enforces ${vitestLines}%`,
  };
}

/** One-line, human-checkable rendering of a resolved threshold. */
function describeThreshold(resolved) {
  if (!resolved) return 'coverage threshold: unknown';
  const parts = [`coverage threshold: ${resolved.value}%`, `source: ${resolved.source}`];
  if (!resolved.declared) parts.push('not declared by any config — this is the hook fallback');
  if (resolved.conflict) parts.push(`CONFLICT — ${resolved.conflict.detail}`);
  return parts.join(' | ');
}

module.exports = { resolveCoverageThreshold, describeThreshold, IMPLICIT_COVERAGE_FLOOR };
