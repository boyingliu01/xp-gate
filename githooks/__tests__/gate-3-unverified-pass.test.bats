#!/usr/bin/env bats
#
# @test REQ-GATE3-UNVERIFIED-PASS
# @intent Gate 3 claimed a PASS over a measurement that never happened, on the
#         ratchet path -- the path this repo actually runs.
#
#         `evaluate_ccn_ratchet` can return three kinds of line:
#
#             BLOCK <name> CCN=...      over the baseline
#             OK <name> CCN=...         at or under it
#             UNVERIFIED ...            no parsable CCN row at all
#
#         The last one exists specifically for #683, whose comment says:
#         "Zero parsable rows means 'unverified', never 'clean'. Before this the
#         verdict came back empty, every counter read 0, and Gate 3 graded a tree
#         nobody measured as compliant."
#
#         The flat-threshold path honours that (gate-3.sh:583-628 probes lizard
#         and emits WARN "complexity not verified"). The RATCHET path does not:
#
#             CC_VIOLATIONS=$(printf '%s\n' "$RATCHET_VERDICT" | grep -c '^BLOCK ')
#             ...
#             if [ "$CC_VIOLATIONS" -gt 0 ]; then block; else PASS; fi
#
#         `UNVERIFIED` contains no "BLOCK", so the count is 0 and the else branch
#         prints:
#
#             ✅ PASSED - Complexity within ratchet baseline.
#
#         Measured live in this repo: the run printed
#             UNVERIFIED no parsable CCN row (lizard produced no measurable function)
#         and then, two lines later, "PASSED", with issues_found=0 in the journal.
#         The same commit could read as clean while nothing had been graded.
#
#         So #683's fix landed on one of the two paths. This test pins the one it
#         missed.
#
# @covers AC-GATE3-UNVERIFIED-01 AC-GATE3-UNVERIFIED-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO/githooks/gate-3.sh"
  WORK="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
}

# The ratchet verdict for input that yields no measurable function, produced by
# the real library rather than retyped -- a retyped expectation would keep
# passing after the library changed its wording.
unverified_verdict() {
  REPO_DIR="$REPO" bash -c '
    source "$REPO_DIR/githooks/lib/ccn-ratchet.sh" 2>/dev/null
    printf "garbage,row\nalso,bad\n" | evaluate_ccn_ratchet ".ccn-baseline.json"
  '
}

@test "AC-GATE3-UNVERIFIED-01: the ratchet library really does emit UNVERIFIED" {
  # Precondition. If this stops holding the test below would pass vacuously --
  # there would be no UNVERIFIED line for the gate to ignore.
  run unverified_verdict
  [ "$status" -eq 0 ] || { echo "evaluate_ccn_ratchet failed: $output"; return 1; }
  [[ "$output" == *"UNVERIFIED"* ]] || {
    echo "the library no longer emits UNVERIFIED for unparsable input; got: $output"
    return 1
  }
  # And it must NOT be mistaken for a violation, or the fix below would be
  # "block everything" rather than "stop claiming a pass".
  [[ "$output" != *"BLOCK "* ]] || {
    echo "unparsable input is being reported as a violation, not as unverified"
    return 1
  }
}

@test "AC-GATE3-UNVERIFIED-02: the gate does not PASS on an UNVERIFIED ratchet verdict" {
  # Structural check on the ratchet arm: it must consult UNVERIFIED before it
  # can reach the PASS branch. Running gate_3.sh end to end needs lizard and a
  # baseline; the decision is the part under test.
  local ratchet_block
  ratchet_block=$(sed -n '/RATCHET_VERDICT=\$(printf/,/✅ PASSED - Complexity within ratchet baseline/p' "$GATE")
  [ -n "$ratchet_block" ] || {
    echo "could not locate the ratchet arm in gate-3.sh"
    return 1
  }
  [[ "$ratchet_block" == *"UNVERIFIED"* ]] || {
    echo "the ratchet arm reaches its PASS branch without ever looking at UNVERIFIED:"
    printf '%s\n' "$ratchet_block"
    return 1
  }
}