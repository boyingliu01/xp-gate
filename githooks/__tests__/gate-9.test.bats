#!/usr/bin/env bats
#
# Tests for the SAST gate.
#
# HISTORY — why this filename does not match the file it tests
# ------------------------------------------------------------
# This test used to do `source ../gate-9.sh` and assert only that
# `GATE_9_STATUS` ended up non-empty. Two things were wrong, and both mattered:
#
#   1. SAST is gate TEN. `githooks/gate-10.sh` is what pre-commit sources
#      (pre-commit:5317). `gate-9.sh` was a dead file no hook sourced.
#   2. The test passed anyway, because "sourced without error" is satisfied by
#      any file defining the variable. That is the "a test exists, therefore it
#      is covered" illusion: #717 was a C# SAST fix written into the dead
#      gate-9.sh, reviewed, and landed — while changing nothing.
#
# The dead file is deleted and the assertions below check SAST *behaviour*
# against the file that actually runs. A test that only proves a file loads
# cannot tell you whether it is the right file.
#
# Identity comes from githooks/gate-registry.sh: `sast` -> 10 -> gate-10.sh.
# scripts/__tests__/gate-identity-cross-surface.test.cjs asserts that binding
# across every surface.

setup() {
  GATE_10_STATUS=""
  GATE_DIR="$BATS_TEST_DIRNAME/.."

  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
}

@test "sast: pre-commit sources gate-10.sh, and that file exists" {
  [ -f "$BATS_TEST_DIRNAME/../gate-10.sh" ]
  grep -q 'gate-10.sh' "$BATS_TEST_DIRNAME/../pre-commit"
}

@test "sast: the dead gate-9.sh is gone, because editing it changes nothing" {
  # Regression guard for #717: if a top-level gate-9.sh reappears, a SAST fix
  # can once again be written into a file no hook runs.
  [ ! -f "$BATS_TEST_DIRNAME/../gate-9.sh" ]
}

@test "sast: gate-10.sh sources without error and sets GATE_10_STATUS" {
  source "$GATE_DIR/gate-10.sh"
  [ -n "$GATE_10_STATUS" ]
}

@test "sast: gate-10.sh reports a verdict from the documented vocabulary" {
  source "$GATE_DIR/gate-10.sh"
  # PASS / FAIL / SKIP / WARN. An empty status is the false green this gate
  # must never produce.
  [[ "$GATE_10_STATUS" =~ ^(PASS|FAIL|SKIP|WARN)$ ]]
}
