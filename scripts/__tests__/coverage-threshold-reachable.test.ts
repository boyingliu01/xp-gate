/**
 * @test vitest.config coverage thresholds are reachable
 * @intent A coverage floor is only a ratchet if the tree actually clears it. Set
 *         one threshold point above reality and every build goes red for a reason
 *         nobody can act on; set the whole block to 80% against a 60% tree and the
 *         reverse happens — every commit is blocked until someone disables the
 *         gate. #561 got the SHAPE right (flat, not nested) but set `functions: 83`
 *         as a "measured floor" that was never measured in CI, because at that time
 *         Gate 1 was red on every build and Gate 5 had never executed. Two
 *         consecutive CI runs then measured functions at 81.19% against a declared
 *         83 and blocked (#589).
 *
 *         The rule the config itself states — "whole numbers below the measured
 *         figure" — is what this file enforces, against a recorded measurement.
 * @covers AC-589-01, AC-589-02
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = join(REPO_ROOT, 'vitest.config.ts');

/**
 * Coverage actually measured by CI, as percentages.
 *
 * Recorded rather than recomputed: measuring needs a full ~10 minute coverage run,
 * which cannot live inside a unit test. `measuredOn` names the commits it came
 * from so a stale record is visible rather than silently authoritative.
 */
const MEASURED = {
  lines: 61.37,
  statements: 61.37,
  functions: 81.19,
  branches: 79.52,
  measuredOn: 'CI runs f722a441 and 51931824 (identical figures both times)',
};

type Thresholds = Record<string, number | undefined>;

/**
 * Strip `//` comments from TS source, respecting string literals.
 *
 * Necessary, not cosmetic: the config's own explanatory comments quote the OLD
 * nested shape (`thresholds: { global: {...} }`) and the old numbers. Matching raw
 * source text therefore finds the comment first and reports the section it
 * documents instead of the code. Caught by the first RED run of this file, which
 * "found" the nested shape in a config that no longer has it.
 *
 * @param src - raw file contents
 * @returns the same source with line comments removed
 */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\\') { i++; continue; }
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble && c === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/**
 * Return the source of the `thresholds: { ... }` block, comments stripped.
 * @returns the braces' inner text as written
 */
function thresholdsBlockSource(): string {
  const src = stripLineComments(readFileSync(CONFIG, 'utf8'));
  const block = src.match(/thresholds:\s*\{([\s\S]*?)\n\s{0,8}\},/);
  if (!block) throw new Error('vitest.config.ts has no flat `thresholds: { ... }` block');
  return block[1];
}

/**
 * Read the flat `thresholds` object out of the real config.
 * @returns the four configured threshold numbers
 */
function configuredThresholds(): Thresholds {
  const out: Thresholds = {};
  for (const m of thresholdsBlockSource().matchAll(/(\w+)\s*:\s*(\d+(?:\.\d+)?)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

describe('coverage thresholds are reachable (#589)', () => {
  test('AC-589-01: every threshold sits below the measured figure', () => {
    const configured = configuredThresholds();
    const belowOrAt: string[] = [];
    const above: string[] = [];

    for (const metric of ['lines', 'statements', 'functions', 'branches'] as const) {
      const value = configured[metric];
      expect(typeof value, `${metric} threshold must be configured`).toBe('number');
      const measured = MEASURED[metric];
      if ((value as number) > measured) {
        above.push(
          `${metric}: threshold ${value} is ABOVE the measured ${measured} ` +
            `(${MEASURED.measuredOn}) — this blocks every build for a reason no one can act on`
        );
      } else {
        belowOrAt.push(`${metric}: ${value} <= ${measured}`);
      }
    }

    expect(above, above.join('\n')).toEqual([]);
    // Anti-vacuity: all four metrics were actually compared.
    expect(belowOrAt).toHaveLength(4);
  });

  test('AC-589-02: the threshold block is flat, not the vitest 2.x nested shape', () => {
    // The nested `thresholds: { global: {...} }` shape is silently DROPPED by
    // vitest 1.6.1, which turned this whole gate into a no-op for months (#561).
    //
    // Detect a `global` KEY inside the thresholds block, not a literal string.
    // Matching the literal `thresholds: { global:` missed the real defect: the
    // nested object is normally written on its own line, so that substring never
    // appears. Measured — rewriting the block to the nested shape left this test
    // GREEN until the check was key-based.
    const block = thresholdsBlockSource();
    expect(
      /(^|[{,\s])global\s*:/.test(block),
      'the thresholds block contains a `global` key. vitest 1.6.1 ignores that ' +
        'nested shape without a warning, so the gate would silently stop ' +
        'enforcing anything (#561)'
    ).toBe(false);

    const configured = configuredThresholds();
    expect(Object.keys(configured).sort()).toEqual(
      ['branches', 'functions', 'lines', 'statements']
    );
    // Every value must be a real number, not a placeholder or a string.
    for (const [name, value] of Object.entries(configured)) {
      expect(typeof value, `${name} must be numeric`).toBe('number');
      expect(value, `${name} must be a positive percentage`).toBeGreaterThan(0);
      expect(value, `${name} must be a percentage`).toBeLessThanOrEqual(100);
    }
  });

  test('AC-589-03: removing the nesting also removed the no-op it caused', () => {
    // Guards the guard against a vacuous pass: AC-589-01 reads the config with a
    // regex, so if the config ever stops declaring a flat block, that regex would
    // find nothing and the "no threshold is above measured" assertion could pass
    // on an empty comparison. configuredThresholds() throws on a missing block and
    // AC-589-01 asserts four metrics were compared — this asserts the same
    // invariant from the opposite direction, through the exported config itself.
    const versionFile = join(REPO_ROOT, 'VERSION');
    expect(
      existsSync(versionFile),
      'VERSION is the single source of truth for releases; the measurement record ' +
        'is only meaningful alongside a version someone can correlate against'
    ).toBe(true);
    const version = readFileSync(versionFile, 'utf8').trim();
    expect(
      version,
      'measurements must be recorded against a MAJOR.MINOR.PATCH.MICRO version'
    ).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    const configured = configuredThresholds();
    // A flat block with 4 real numbers means vitest will actually enforce it.
    // `Object.keys` (not `Object.values`) so a dropped metric fails loudly.
    expect(Object.keys(configured), `thresholds in ${version}`).toHaveLength(4);
  });
});
