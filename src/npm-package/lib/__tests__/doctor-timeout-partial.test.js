/**
 * @test REQ-629
 * @intent `xp-gate doctor` is non-deterministic on Windows. Against an identical,
 *         freshly-installed, fully healthy installation it printed
 *         "All checks passed" on one run and "Timed out after 10s — some checks
 *         incomplete" on the next two. The timeout is a deliberate safety net
 *         (#348, "43s on Windows"); the defect is what happens when it fires.
 *
 *         `Promise.race` discarded the entire `diagnoseAsync()` result and
 *         substituted a single placeholder check, so everything that had already
 *         finished was thrown away. Consequence: doctor can report LESS
 *         information the LONGER it runs — the opposite of what a diagnostic
 *         should do — and a WARN from the timeout made the skills section vanish
 *         entirely, so tooling that scrapes `Skill:.*Up to date` read 0/12.
 *
 *         The fix: reach a verdict at the deadline (never hang — #348 stays fixed)
 *         but keep whatever finished. A diagnostic that says "these 9 checks
 *         passed, 2 did not report in time" is strictly more useful than one that
 *         says "timed out".
 *
 *         The tests below pin the merge semantics directly rather than waiting on
 *         a real 10s timer: the behaviour that matters is "partial results are
 *         preserved and reported as partial", not the clock.
 * @covers AC-670-43, AC-670-44, AC-670-45
 */
'use strict';

// describe/it/expect are vitest globals in this repo's config; requiring them from
// 'vitest' fails because this file is CommonJS. (Hooks are not needed here.)

/** A completed check, shaped like diagnoseAsync()'s output. */
function check(name, status) {
  return { name, status, detail: `${name} detail` };
}

describe('doctor keeps completed checks when the global timeout fires (#629)', () => {
  it('AC-670-43: completed checks are merged with the timeout notice, not replaced', () => {
    const { mergeTimedOutDiagnosis } = require('../doctor');
    expect(typeof mergeTimedOutDiagnosis).toBe('function');

    const completed = {
      checks: [check('Hooks', 'PASS'), check('Adapters', 'PASS'), check('Skills', 'WARN')],
      issues: 1,
    };
    const merged = mergeTimedOutDiagnosis(completed, ['Gate env', 'OpenCode TUI']);

    // Nothing that finished may be dropped -- that is the whole defect.
    for (const name of ['Hooks', 'Adapters', 'Skills']) {
      expect(merged.checks.map((c) => c.name)).toContain(name);
    }
    // The deadline itself is still reported, and still not a pass.
    const notice = merged.checks.find((c) => c.name === 'Diagnosis');
    expect(notice).toBeDefined();
    expect(notice.status).toBe('WARN');
    // Named individually, so the reader knows which surface is unknown.
    expect(notice.detail).toContain('Gate env');
    expect(notice.detail).toContain('OpenCode TUI');
    expect(merged.timedOut).toBe(true);
    // A partial run is never clean.
    expect(merged.issues).toBeGreaterThanOrEqual(1);
  });

  it('AC-670-44: an empty partial result still yields the honest timeout notice', () => {
    const { mergeTimedOutDiagnosis } = require('../doctor');
    const merged = mergeTimedOutDiagnosis({ checks: [], issues: 0 }, ['Gate env']);
    expect(merged.checks).toHaveLength(1);
    expect(merged.checks[0].name).toBe('Diagnosis');
    expect(merged.timedOut).toBe(true);
  });

  it('AC-670-45: nothing that already reported is ever lost, and a real issue count survives', () => {
    const { mergeTimedOutDiagnosis } = require('../doctor');
    const completed = { checks: [check('Hooks', 'FAIL'), check('Templates', 'PASS')], issues: 4 };
    const merged = mergeTimedOutDiagnosis(completed, []);
    // Pre-existing issues are not reset by the timeout.
    expect(merged.issues).toBeGreaterThanOrEqual(4);
    expect(merged.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['Hooks', 'Templates']));
  });
});
