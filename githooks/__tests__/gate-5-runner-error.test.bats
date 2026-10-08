#!/usr/bin/env bats

# ============================================================================
# Issue #454: Gate 5 must distinguish a real test failure from a vitest
# *runner infrastructure* error.
#
# Background: on Windows, vitest 1.6.x can exit non-zero while reporting zero
# failed tests, because its temp/ssr module cache hits EPERM. Reporting that as
# "Tests FAILED" sends developers hunting for a bug that does not exist.
#
# The discriminating helper `is_runner_infrastructure_error` existed already,
# but only ONE of the six `BLOCKED - Tests FAILED` sites used it. These tests
# pin the helper's contract AND assert every applicable call site is guarded,
# so a future site cannot silently regress to the blanket message.
#
# Hard constraints (from the issue):
#   - A real test failure must STILL block.
#   - The guard must not weaken gate strength.
#   - Non-vitest generic paths stay unguarded (their output format differs).
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  LIB="$REPO_ROOT/githooks/lib/test-failure.sh"
}

# ---------------------------------------------------------------------------
# Unit tests: the discriminator itself.
# ---------------------------------------------------------------------------

@test "#454 is_runner_infrastructure_error: Unhandled Errors with 0 failed tests is a runner error" {
  run bash -c "
    source "$LIB"
    is_runner_infrastructure_error 'Test Files  1 passed (1)
Tests  14 passed (14)
Errors  1 error

⎯⎯⎯ Unhandled Errors ⎯⎯⎯
Error: EPERM: operation not permitted, open /tmp/ssr/40b9f1f37d5bd759'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=0"* ]]
}

@test "#454 is_runner_infrastructure_error: a real test failure is NOT a runner error" {
  run bash -c "
    source "$LIB"
    is_runner_infrastructure_error 'Test Files  1 failed (1)
Tests  1 failed (1)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: real failure wins even when Unhandled Errors also present" {
  # Both markers present -> must be treated as a REAL failure (fail-closed).
  run bash -c "
    source "$LIB"
    is_runner_infrastructure_error 'Tests  1 failed (1)
⎯⎯⎯ Unhandled Errors ⎯⎯⎯
Error: EPERM'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: clean output is not a runner error" {
  run bash -c "
    source "$LIB"
    is_runner_infrastructure_error 'Test Files  2 passed (2)
Tests  20 passed (20)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: empty input is not a runner error" {
  run bash -c "
    source "$LIB"
    is_runner_infrastructure_error ''
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

# ---------------------------------------------------------------------------
# Anti-vacuity: assert the guard is actually WIRED at every applicable site.
# A helper that exists but is never called fixes nothing.
# ---------------------------------------------------------------------------

@test "#454 anti-vacuity: every vitest Gate 5 block site consults the handler" {
  # The five sites that run vitest can emit the EPERM signature. Once the
  # judgement moved into lib/test-failure.sh, the hook-side invariant is that
  # every site calls the handler AND none prints the blanket BLOCKED message
  # itself — an unguarded site is precisely the bug this issue was about.
  run grep -c 'handle_test_failure "\$TESTS_OUTPUT"' "$HOOK"
  [ "$status" -eq 0 ]
  # 4 vitest branches + the two typescript adapter fallbacks (#498).
  [ "$output" -ge 6 ]

  # Whatever blanket messages remain must be exactly the one generic run_tests
  # path that #454 genuinely leaves unguarded: the NON-vitest runner branch, whose
  # output shape is not vitest's. The typescript paths used to be counted here as
  # well, but adapters/typescript.sh runs vitest — leaving them unguarded is what
  # false-blocked every test-less TS project (#498).
  #
  # The old form proved this with a `grep -B` lookback over `run_tests`, but that
  # window had to grow every time a reason was written between the command and
  # its block (#498 pushed it from 6 lines to 13). Locating the message inside
  # the branch instead pins the structure, not the spacing.
  run grep -c 'BLOCKED - Tests FAILED' "$HOOK"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]

  run bash -c "awk '/Genuinely non-vitest runners/,/PASSED - Unit tests passed/' '$HOOK' | grep -c 'BLOCKED - Tests FAILED'"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "#454 anti-vacuity: the handler defines the guard and consults it" {
  run grep -c 'is_runner_infrastructure_error' "$LIB"
  [ "$status" -eq 0 ]
  # 1 definition + at least one call from handle_test_failure.
  [ "$output" -ge 2 ]
}

@test "#454 non-vitest generic test paths keep blocking on any non-zero exit" {
  # The `run_tests` path for a language whose runner is NOT vitest must not consult
  # the guard: its output shape is not vitest's, so a guard there could
  # theoretically let a real failure through. #498 split this branch by runner
  # rather than by label, so the boundary is now stated where it actually lives.
  # grep -c exits 1 when it finds nothing, which is the passing case here, so
  # only the count is asserted.
  #
  # Anti-vacuity first: an awk range whose start pattern stopped matching yields
  # EMPTY input, and `grep -c` on empty input prints 0 -- the assertion below
  # would then pass while proving nothing. Pin the range to be non-trivial.
  run bash -c "awk '/Genuinely non-vitest runners/,/^            fi\$/' '$HOOK' | wc -l"
  [ "$status" -eq 0 ]
  [ "$output" -ge 5 ]

  run bash -c "
    awk '/Genuinely non-vitest runners/,/^            fi\$/' '$HOOK' | grep -cE 'is_runner_infrastructure_error|is_partial_threshold_only_exit|handle_test_failure'
  "
  [ "$output" -eq 0 ]

  # And the split must be conditional on the runner, not unconditional. One
  # occurrence is the truth: exactly one typescript arm, sitting next to the
  # non-vitest arm the assertion above just proved is guard-free.
  run bash -c "awk '/Adapter test flow for everything/,/^      fi\$/' '$HOOK' | grep -c 'CURRENT_LANG\" = \"typescript\"'"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}
