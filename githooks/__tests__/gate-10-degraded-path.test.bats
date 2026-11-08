#!/usr/bin/env bats

# Tests for the Gate 10 degraded path (Step E1).
#
# The SAST daemon (sastd) is an optimisation: it reuses one Python process so the
# ~6s `import semgrep` tax is paid once per machine instead of once per gate run.
# Everything below exists to guarantee that turning it OFF, or having it fail,
# leaves the gate behaving EXACTLY as it does today.
#
# That guarantee is the whole point of E1 and it must be testable before any fast
# path is written. A speed-up that can silently degrade into "nothing ran, report
# success" is the #518/#559 failure class this file guards against.

setup() {
  GATE_10_STATUS=""
  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
  # Gate 10 reads staged files; give every test a deterministic empty set unless it
  # overrides git itself.
  git() {
    case "$*" in
      "diff --cached --name-only --diff-filter=ACM"*) return 0 ;;
    esac
    command git "$@"
  }
}

teardown() {
  unset XP_GATE_SASTD
}

@test "E1-01: XP_GATE_SASTD=off selects the direct path" {
  XP_GATE_SASTD=off
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
}

@test "E1-02: unset XP_GATE_SASTD selects the direct path today (no daemon yet)" {
  unset XP_GATE_SASTD
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  # Until E2/E3 land, the daemon does not exist. Defaulting to "direct" means
  # shipping E1 changes no behaviour at all.
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
}

@test "E1-03: an unusable daemon degrades to direct, never to a silent pass" {
  # sastd explicitly requested but no reachable endpoint configured: the gate must
  # fall back to the direct invocation, and it must say so.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
  [ "$GATE_10_SASTD_DEGRADED" = "1" ]
}

@test "E1-04: the degraded path still produces a real verdict" {
  # Asserting merely "status is one of four words" is near-tautological: the
  # fixture stages no files, so a completed run can only be SKIP, and the regex
  # would pass for any outcome. Pin the exact verdict this fixture must produce,
  # which is what proves the degraded path reaches the verdict logic at all
  # rather than returning early.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_STATUS" = "SKIP" ]
  [ "$GATE_10_REASON" = "no_supported_files" ]
}

@test "E1-05: degradation actually reaches the published report, not just a variable" {
  # E1-05 used to assert `[ -n "$GATE_10_REASON" ]`, which was vacuous: REASON is
  # set unconditionally at the top of the script, so the assertion passed for any
  # input and proved nothing about visibility. The real claim is end-to-end --
  # a reader of the report JSON can tell a degraded run from a normal one.
  #
  # Check the two links that make that true: pre-commit must interpolate the
  # field, and gate-10 must have set it.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SASTD_DEGRADED" = "1" ]

  run grep -c '"degraded": ${GATE_10_SASTD_DEGRADED:-0}' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$output" = "1" ]
}

@test "E1-06: auto is not degraded -- absence of a daemon is the normal state" {
  # `auto` means "use it if present". Most users have no daemon, and marking that
  # as degraded would make the flag meaningless the moment E2 lands.
  XP_GATE_SASTD=auto
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
  [ "$GATE_10_SASTD_DEGRADED" = "0" ]
}

@test "E1-07: a notice goes to stderr, never to the parent's stdout" {
  # gate-10.sh is SOURCED by pre-commit. Anything on stdout joins the parent's
  # report stream and can corrupt a consumer that parses it; stderr still reaches
  # the developer.
  #
  # Both directions are asserted. Checking only "not on stdout" would stay green
  # if someone later deleted the echo outright -- the notice would be lost in
  # silence and the degraded run would have no announcement at all. The pair is
  # the claim: the notice exists AND it is on fd 2.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh" >"$BATS_TEST_TMPDIR/out" 2>"$BATS_TEST_TMPDIR/err"

  grep -q "sastd requested" "$BATS_TEST_TMPDIR/err"
  ! grep -q "sastd requested" "$BATS_TEST_TMPDIR/out"
}

@test "E1-08: an unrecognised value is named on stderr so it can be fixed" {
  # Capture stderr without running the source in a subshell: `$(source ...)`
  # evaluates in a child, so GATE_10_* would be set there and be invisible here.
  # Redirect to a file instead, which keeps the source in THIS shell.
  XP_GATE_SASTD=bogus-mode
  source "$BATS_TEST_DIRNAME/../gate-10.sh" >/dev/null 2>"$BATS_TEST_TMPDIR/err"

  [ "$GATE_10_SASTD_DEGRADED" = "1" ]
  grep -q "bogus-mode" "$BATS_TEST_TMPDIR/err"
}
