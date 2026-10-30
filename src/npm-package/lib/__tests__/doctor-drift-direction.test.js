/**
 * @test REQ-670 doctor: classify module drift by DIRECTION, not by line counts
 * @intent `xp-gate doctor` used to report five gate modules as
 *
 *           diverged both ways — githooks/ has 70 line(s) the install lacks,
 *           the install has 2 line(s) githooks/ lacks; sync refuses without an
 *           explicit decision
 *
 *         I checked every "<" line (installed-only) by hand: all of them were
 *         OLDER versions of code the repository had already rewritten. The
 *         "install has 2 lines githooks lacks" was purely the shape a re-wrapped
 *         line leaves in a line-level diff — the same logic, with a `&&` or a
 *         pipe moved onto a new line, produces a line present on neither side.
 *
 *         The wording matters more than it looks. "diverged both ways" plus
 *         "sync refuses without an explicit decision" tells the reader that both
 *         sides hold something worth keeping and a human must choose. The
 *         consequence is not extra keystrokes: it makes people AVOID syncing,
 *         because syncing appears to discard the installed copy's work. And not
 *         syncing is exactly #451 — editing githooks/ and having nothing happen.
 *
 *         So the classifier must ask "does the installed copy hold anything the
 *         repo genuinely lacks?" instead of "are both line counts non-zero?".
 *         Token-level comparison answers the real question: whitespace and line
 *         breaks are formatting, and formatting is not work.
 * @covers AC-670-64, AC-670-65, AC-670-66
 */
'use strict';

const { moduleDriftDetail } = require('../doctor');

/** Join lines the way a formatter re-wraps them: same tokens, different breaks. */
const wrap = (...lines) => lines.join('\n');

describe('moduleDriftDetail direction classification (#667)', () => {
  it('AC-670-64: a pure re-wrap is "behind", not "diverged both ways"', () => {
    // Same logic; the `&&` moved to the next line. A line-level diff calls this
    // two-sided drift. Nothing was authored on the installed side.
    // Real shape measured on gate-3.sh: an older install re-wrapped the same
    // statements, so a line-level diff reports lines unique to BOTH sides while
    // the token content is identical (measured: repoOnly=0, installedOnly=0).
    const repo = wrap(
      'RATCHET_LIB="$GATE_DIR/lib/ccn-ratchet.sh"',
      'if [ -f "$RATCHET_LIB" ]; then . "$RATCHET_LIB"; fi',
      'known.set(norm(f.file) + "::" + f.name, Number(f.ccn) || 0);',
    );
    const installed = wrap(
      '        RATCHET_LIB="$GATE_DIR/lib/ccn-ratchet.sh"',
      '        if [ -f "$RATCHET_LIB" ]; then',
      '          . "$RATCHET_LIB"',
      '        fi',
      'known.set(norm(f.file) + "::" + f.name,',
      '          Number(f.ccn) || 0);',
    );
    const detail = moduleDriftDetail(repo, installed);
    expect(detail).not.toMatch(/diverged both ways/i);
    expect(detail).toMatch(/formatting|stale|behind/i);
  });

  it('AC-670-65: a genuine two-sided edit still refuses to sync silently', () => {
    // The installed copy carries a real, machine-only hardening: a fail-closed
    // branch that exists nowhere in the repo. Overwriting it would destroy work.
    const repo = wrap(
      'if [ -z "$COV" ]; then',
      '  echo "no coverage tool";',
      '  return 0;',
      'fi',
    );
    const installed = wrap(
      'if [ -z "$COV" ]; then',
      '  # FAIL CLOSED: cannot determine coverage means the check failed.',
      '  echo "❌ BLOCKED - could not determine coverage";',
      '  return 1;',
      'fi',
    );
    const detail = moduleDriftDetail(repo, installed);
    expect(detail).toMatch(/diverged both ways/i);
    expect(detail).toMatch(/refuses|explicit decision/i);
  });

  it('AC-670-66: an unreadable pair is reported honestly, never as identical', () => {
    // readPair() returns null when either side cannot be read. Reporting that as
    // "matches" would be a fail-open: the drift could be real and unseen.
    const detail = moduleDriftDetail(null, null);
    expect(detail).toMatch(/could not be read|cannot be compared/i);
    expect(detail).not.toMatch(/matches|identical/i);
  });
});

describe('re-wrap is not drift (#667)', () => {
  it('AC-670-64: a pure re-wrap yields no unique tokens on either side', () => {
    // The end-to-end property: formatting-only differences must not count as an
    // issue, because failing on them teaches the reader to distrust `doctor`
    // and to skip the sync that #451 exists to encourage.
    const { tokenDelta } = require('../doctor.js');
    const NL = String.fromCharCode(10);
    const repo = 'a &&' + NL + '  b' + NL;
    const installed = 'a' + NL + '  && b' + NL;
    const delta = tokenDelta(repo, installed);
    expect(delta.repoOnly).toBe(0);
    expect(delta.installedOnly).toBe(0);
    expect(moduleDriftDetail(repo, installed)).toMatch(/formatting/i);
  });
});
