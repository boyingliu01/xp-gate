#!/usr/bin/env bats

# ============================================================================
# Issue #473: Gate 5 partial-run false block.
#
# A subset vitest run (`vitest run --coverage <few files>`) can never satisfy
# the project's GLOBAL coverage thresholds, so vitest exits non-zero with
# "does not meet global threshold" errors even when every test passed. Gate 5's
# partial-run branches misread that as "BLOCKED - Tests FAILED" and blocked
# every commit that touched a single test file.
#
# Downstream, the same hook already treats partial coverage <80% as a warning
# (PARTIAL_TEST_RUN guard) — the intent is unambiguous; the vitest call sites
# just never let execution reach it.
#
# Hard constraints:
#   - Only subset runs (PARTIAL_TEST_RUN=true) may be excused; a full-suite
#     threshold failure must still block.
#   - A real test failure must STILL block, even with threshold noise present.
#
# Note: this file extracts the function definitions instead of `source`-ing
# the whole hook — the pre-commit monolith has no --source-only guard, and
# sourcing it executes the gates. Extraction keeps these tests hermetic and
# cross-platform.
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  FN_LIB="$(mktemp)"
  awk '/^is_partial_threshold_only_exit\(\)/,/^\}/' "$HOOK" >>"$FN_LIB"
  THRESHOLD_OUTPUT='Test Files  1 passed (1)
      Tests  21 passed (21)
ERROR: Coverage for lines (10.87%) does not meet global threshold (80%)
ERROR: Coverage for statements (10.29%) does not meet global threshold (80%)'
}

teardown() {
  rm -f "$FN_LIB"
}

# ---------------------------------------------------------------------------
# Unit tests: the discriminator itself.
# ---------------------------------------------------------------------------

@test "#473 is_partial_threshold_only_exit: partial run + threshold-only exit is excused" {
  run bash -c "
    source '$FN_LIB'
    PARTIAL_TEST_RUN=true
    is_partial_threshold_only_exit '$THRESHOLD_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=0"* ]]
}

@test "#473 is_partial_threshold_only_exit: full-suite threshold failure is NOT excused" {
  run bash -c "
    source '$FN_LIB'
    PARTIAL_TEST_RUN=false
    is_partial_threshold_only_exit '$THRESHOLD_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 is_partial_threshold_only_exit: real failure wins over threshold noise (fail-closed)" {
  run bash -c "
    source '$FN_LIB'
    PARTIAL_TEST_RUN=true
    is_partial_threshold_only_exit 'Tests  1 failed (1)
FAIL tests/foo.test.ts
ERROR: Coverage for lines (10%) does not meet global threshold (80%)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 is_partial_threshold_only_exit: partial run without threshold marker is not excused" {
  run bash -c "
    source '$FN_LIB'
    PARTIAL_TEST_RUN=true
    is_partial_threshold_only_exit 'Some other vitest crash'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 is_partial_threshold_only_exit: unset PARTIAL_TEST_RUN stays strict (set -u safe)" {
  run bash -c "
    set -u
    source '$FN_LIB'
    is_partial_threshold_only_exit '$THRESHOLD_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

# ---------------------------------------------------------------------------
# Anti-vacuity: the guard must be WIRED at both subset call sites and absent
# from the full-suite fallbacks (which must keep blocking on threshold exits).
# ---------------------------------------------------------------------------

@test "#473 anti-vacuity: both subset branches consult the guard" {
  run bash -c "
    grep -A 30 'changed test file(s) with coverage' '$HOOK' | grep -c 'is_partial_threshold_only_exit'
  "
  [ "$output" -ge 1 ]
  run bash -c "
    grep -A 12 'Found related test(s)' '$HOOK' | grep -c 'is_partial_threshold_only_exit'
  "
  [ "$output" -ge 1 ]
}

@test "#473 anti-vacuity: full-suite fallbacks are NOT excused by the guard" {
  # The 'No related test files found' fallback and the >20-files full run must
  # keep blocking on threshold exits — the guard reads PARTIAL_TEST_RUN, but a
  # structural assertion pins the intent as well.
  run bash -c "
    grep -A 8 'running full test suite' '$HOOK' | grep -c 'is_partial_threshold_only_exit' || true
  "
  [ "$output" -eq 0 ]
}

@test "#473 anti-vacuity: PARTIAL_TEST_RUN is still set by exactly the subset branches" {
  run grep -c 'PARTIAL_TEST_RUN=true' "$HOOK"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]
}

@test "#473 wiring: guard is excused BEFORE the block branch at the changed-tests site" {
  # Ordering matters: the elif must sit between the #454 runner-error branch
  # and the BLOCKED else, so a genuine failure cannot take the excuse branch.
  run bash -c "
    awk '/changed test file\(s\) with coverage/,/PASSED - Changed test files/' '$HOOK' \\
      | grep -nE 'is_runner_infrastructure_error|is_partial_threshold_only_exit|BLOCKED - Tests FAILED' \\
      | awk -F: '{print \$1}' | wc -l
  "
  [ "$output" -eq 3 ]
  run bash -c "
    awk '/changed test file\(s\) with coverage/,/PASSED - Changed test files/' '$HOOK' \\
      | grep -nE 'is_partial_threshold_only_exit|BLOCKED - Tests FAILED' | head -1
  "
  guard_line="$(echo "$output" | cut -d: -f1)"
  run bash -c "
    awk '/changed test file\(s\) with coverage/,/PASSED - Changed test files/' '$HOOK' \\
      | grep -nE 'is_partial_threshold_only_exit|BLOCKED - Tests FAILED' | tail -1
  "
  block_line="$(echo "$output" | cut -d: -f1)"
  [ "$guard_line" -lt "$block_line" ]
}

@test "#473 wiring: the #454 runner-error branch precedes the #473 guard at the changed-tests site" {
  # The docstring promises the elif sits BETWEEN the runner-error branch and
  # the BLOCKED else; pin all three relative positions, not just two.
  run bash -c "
    awk '/changed test file\(s\) with coverage/,/PASSED - Changed test files/' '$HOOK' \\
      | grep -nE 'is_runner_infrastructure_error|is_partial_threshold_only_exit' | head -2
  "
  runner_line="$(echo "$output" | sed -n '1p' | cut -d: -f1)"
  guard_line="$(echo "$output" | sed -n '2p' | cut -d: -f1)"
  [ -n "$runner_line" ] && [ -n "$guard_line" ]
  [ "$runner_line" -lt "$guard_line" ]
}

@test "#473 contract: excuse branches do NOT set TESTS_SKIPPED (coverage path still runs)" {
  # Setting TESTS_SKIPPED would skip Stage 1/2 coverage for every language and
  # suppress the partial-run warning this fix exists to reach. The tests DID
  # run and DID produce coverage data — only the vitest threshold exit is excused.
  # Start only at call sites (guard invoked with "$TESTS_OUTPUT"), NOT at the
  # function definition, whose range would swallow the unrelated #454 branch.
  run bash -c "
    awk '/is_partial_threshold_only_exit \"/,/BLOCKED - Tests FAILED/' '$HOOK' | grep -c 'TESTS_SKIPPED=true' || true
  "
  [ "$output" -eq 0 ]
}
