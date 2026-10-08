#!/usr/bin/env bats

# ============================================================================
# Issue #473: Gate 5 must not read vitest's coverage-threshold exit as a test
# failure when it deliberately ran a SUBSET of the suite.
#
# Background: the "changed test files" and "related test files" branches of
# Gate 5 run `npx vitest run --coverage <a few files>`. vitest applies the
# project's GLOBAL coverage thresholds to that subset, so a subset that passes
# every test still exits 1 with
#   "ERROR: Coverage for lines (10.87%) does not meet global threshold (80%)".
# handle_test_failure only excused runner-infrastructure errors (#454), so this
# exit was reported as "❌ BLOCKED - Tests FAILED in changed test files" — a
# structural false block on every partial run that has real node installed.
#
# The design intent was already there: the coverage checks downstream
# (PARTIAL_TEST_RUN branches) downgrade a partial run's <80% to a warning. The
# exit-code judgement upstream just never reached them.
#
# Hard constraints (from the issue):
#   - Only PARTIAL_TEST_RUN=true may be excused; a full-suite threshold miss
#     still blocks.
#   - A real assertion failure inside the subset still blocks.
#   - Non-vitest generic run_tests paths stay unguarded (same boundary as #454).
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  LIB="$REPO_ROOT/githooks/lib/test-failure.sh"
}

# vitest's real shape for this case: everything passed, the threshold did not.
THRESHOLD_ONLY_OUTPUT='Test Files  2 passed (2)
     Tests  21 passed (21)
      10.29% of all files ( 5.11M)
ERROR: Coverage for lines (10.87%) does not meet global threshold (80%)
ERROR: Coverage for statements (10.87%) does not meet global threshold (80%)'

# ---------------------------------------------------------------------------
# Unit tests: the discriminator itself.
# ---------------------------------------------------------------------------

@test "#473 partial run with a threshold-only exit is excused" {
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    is_partial_threshold_only_exit '$THRESHOLD_ONLY_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=0"* ]]
}

@test "#473 the same output from a FULL run still blocks" {
  run bash -c "
    PARTIAL_TEST_RUN=false
    source "$LIB"
    is_partial_threshold_only_exit '$THRESHOLD_ONLY_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 PARTIAL_TEST_RUN unset means full run, so it still blocks" {
  run bash -c "
    unset PARTIAL_TEST_RUN
    source "$LIB"
    is_partial_threshold_only_exit '$THRESHOLD_ONLY_OUTPUT'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 a real assertion failure inside the subset is never excused" {
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    is_partial_threshold_only_exit 'Test Files  1 failed (1)
     Tests  1 failed | 20 passed (21)
 FAIL  src/foo.test.ts > bar
AssertionError: expected 1 to be 2
ERROR: Coverage for lines (10.87%) does not meet global threshold (80%)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 a partial run without a threshold complaint is not excused by this helper" {
  # Empty/other failures must fall through to the normal BLOCKED path.
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    is_partial_threshold_only_exit 'Test Files  1 failed (1)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#473 empty output is never excused" {
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    is_partial_threshold_only_exit ''
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

# ---------------------------------------------------------------------------
# Integration: handle_test_failure must route the excused case to a SKIP with
# an explanation, and leave the blocking case alone.
# ---------------------------------------------------------------------------

@test "#473 handle_test_failure reports SKIPPED, not BLOCKED, for an excused partial run" {
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    handle_test_failure '$THRESHOLD_ONLY_OUTPUT' 'changed test files'
    echo \"status=\$? skipped=\${TESTS_SKIPPED:-unset} exit_code=\$TESTS_EXIT_CODE\"
  "
  [[ "$output" == *"status=0"* ]]
  [[ "$output" == *"SKIPPED"* ]]
  [[ "$output" == *"threshold"* ]]
  [[ "$output" == *"exit_code=0"* ]]
  # The coverage section must still run: it carries the new-file coverage block,
  # so flagging this as a skipped test run would silently weaken Gate 5.
  [[ "$output" == *"skipped=unset"* ]]
}

@test "#473 handle_test_failure still BLOCKS a full-suite threshold miss" {
  run bash -c "
    PARTIAL_TEST_RUN=false
    source "$LIB"
    handle_test_failure '$THRESHOLD_ONLY_OUTPUT' 'full test suite'
    echo \"status=\$?\"
  "
  [[ "$output" == *"status=1"* ]]
  [[ "$output" == *"BLOCKED - Tests FAILED"* ]]
}

@test "#473 handle_test_failure still BLOCKS a real failure inside a partial run" {
  run bash -c "
    PARTIAL_TEST_RUN=true
    source "$LIB"
    handle_test_failure 'Tests  1 failed (1)
AssertionError: expected 1 to be 2' 'changed test files'
    echo \"status=\$?\"
  "
  [[ "$output" == *"status=1"* ]]
  [[ "$output" == *"BLOCKED - Tests FAILED"* ]]
}

# ---------------------------------------------------------------------------
# Anti-vacuity: the helper must be reachable from the shared handler, not just
# defined next to it.
# ---------------------------------------------------------------------------

@test "#473 anti-vacuity: the helper is defined once and consulted by the handler" {
  run grep -c 'is_partial_threshold_only_exit' "$LIB"
  [ "$status" -eq 0 ]
  # 1 definition + >=1 call inside handle_test_failure.
  [ "$output" -ge 2 ]
}

@test "#473 anti-vacuity: the excusal lives inside handle_test_failure, not at one call site" {
  # Every vitest Gate 5 branch already funnels through handle_test_failure; if
  # the new judgement were wired at a single site the others would keep the
  # false block, so assert the call is between the handler's definition and its
  # final BLOCKED echo.
  run bash -c "
    awk '
      /^handle_test_failure\(\) \{/ { in_fn=1 }
      in_fn && /is_partial_threshold_only_exit/ { found=1 }
      in_fn && /^}/ { in_fn=0 }
      END { print (found ? \"wired\" : \"missing\") }
    ' '$LIB'
  "
  [[ "$output" == *"wired"* ]]
}

@test "#473 anti-vacuity: pre-commit sources the library instead of defining the helpers itself" {
  # A library nobody sources leaves the hook with `handle_test_failure: command
  # not found`, which the `|| exit 1` callers would turn into a block on every
  # commit -- fail-closed, but not a working gate.
  run grep -c 'source "${AUDIT_SCRIPT_DIR}/lib/test-failure.sh"' "$HOOK"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "#473 anti-vacuity: every vitest Gate 5 branch still funnels through the handler" {
  run grep -c 'handle_test_failure "\$TESTS_OUTPUT"' "$HOOK"
  [ "$status" -eq 0 ]
  # 4 vitest branches, plus the two typescript adapter fallbacks that #498 showed
  # run vitest too (one without package.json, one without coverage). Stated as a
  # floor on purpose: an exact count here rejected every legitimate new branch
  # while still passing if a branch bypassed the handler.
  [ "$output" -ge 6 ]
}
