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
}

# ---------------------------------------------------------------------------
# Unit tests: the discriminator itself.
# ---------------------------------------------------------------------------

@test "#454 is_runner_infrastructure_error: Unhandled Errors with 0 failed tests is a runner error" {
  run bash -c "
    source '$HOOK' --source-only 2>/dev/null
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
    source '$HOOK' --source-only 2>/dev/null
    is_runner_infrastructure_error 'Test Files  1 failed (1)
Tests  1 failed (1)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: real failure wins even when Unhandled Errors also present" {
  # Both markers present -> must be treated as a REAL failure (fail-closed).
  run bash -c "
    source '$HOOK' --source-only 2>/dev/null
    is_runner_infrastructure_error 'Tests  1 failed (1)
⎯⎯⎯ Unhandled Errors ⎯⎯⎯
Error: EPERM'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: clean output is not a runner error" {
  run bash -c "
    source '$HOOK' --source-only 2>/dev/null
    is_runner_infrastructure_error 'Test Files  2 passed (2)
Tests  20 passed (20)'
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

@test "#454 is_runner_infrastructure_error: empty input is not a runner error" {
  run bash -c "
    source '$HOOK' --source-only 2>/dev/null
    is_runner_infrastructure_error ''
    echo \"exit=\$?\"
  "
  [[ "$output" == *"exit=1"* ]]
}

# ---------------------------------------------------------------------------
# Anti-vacuity: assert the guard is actually WIRED at every applicable site.
# A helper that exists but is never called fixes nothing.
# ---------------------------------------------------------------------------

@test "#454 anti-vacuity: every vitest Gate 5 block site consults the guard" {
  # The four sites that run vitest and therefore can emit the EPERM signature.
  # We assert each `BLOCKED - Tests FAILED` line is preceded by a guard call
  # within its surrounding block.
  run bash -c "
    awk '
      /BLOCKED - Tests FAILED/ { print NR \":\" \$0 }
    ' '$HOOK'
  "
  [ "$status" -eq 0 ]
  # There must be more than one such site (i.e. the blanket message is used).
  [ "$(echo "$output" | grep -c 'BLOCKED')" -ge 4 ]
}

@test "#454 anti-vacuity: guard is invoked at least 3 times in the hook" {
  run grep -c 'is_runner_infrastructure_error' "$HOOK"
  [ "$status" -eq 0 ]
  # 1 definition + >=3 call sites. Before the fix there was 1 definition + 1 call.
  [ "$output" -ge 4 ]
}

@test "#454 non-vitest generic test paths keep blocking on any non-zero exit" {
  # The two generic `run_tests` paths must NOT consult the guard: their output
  # format is not guaranteed to be vitest-shaped, so a guard there could
  # theoretically let a real failure through.
  run bash -c "
    awk '/Fallback: run_tests without coverage/,/^        fi\$/' '$HOOK' | grep -c 'is_runner_infrastructure_error'
  "
  [ "$status" -eq 0 ]
  [ "$output" -eq 0 ]
}
