/**
 * @test REQ-DELPHI-PROBE-FAILS-CLOSED
 * @intent A probe that could not RUN must not report that the seats are ALLOWED.
 *
 *         `probe()` returned True when `WHALECLOUD_API_KEY` was missing, and
 *         `probe_profile()` returned True when no active profile resolved. Both printed
 *         "PROBE SKIP" and then exited as if everything had passed, so CI reported
 *         "ALL SEATS ALLOWED" from a run that never reached the gateway. Three reviewers
 *         raised it independently on the same diff.
 *
 *         This is the same rule the rest of the repository applies: "not checked" must
 *         never be indistinguishable from "passed".
 *
 * @covers AC-DELPHI-PROBE-FAILS-CLOSED-01
 */

'use strict';

// `describe`/`it`/`expect` are globals here (vitest `globals: true`); importing them
// would shadow the globals with `undefined` and collect ZERO tests silently.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '..', 'check_delphi_local_models.py');

/** Run the probe with the key deliberately absent. */
function probeWithoutKey() {
  const env = { ...process.env };
  delete env.WHALECLOUD_API_KEY;
  return execFileSync('python3', [SCRIPT, '--probe'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('the seat probe without a credential', () => {
  it('says FAIL and that nothing was measured', () => {
    let out = '';
    try {
      out = probeWithoutKey();
    } catch (err) {
      // A non-zero exit is also correct; the message is what matters.
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(out).toContain('PROBE FAIL');
    expect(out).toContain('nothing was measured');
    // The old behaviour, which must not come back.
    expect(out).not.toContain('PROBE SKIP: WHALECLOUD_API_KEY not set');
  });
});
