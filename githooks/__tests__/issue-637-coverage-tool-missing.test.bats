#!/usr/bin/env bats
# @test REQ-637
# @intent enforce_python_coverage() answers "is Python coverage at or above the
#         floor?" and it had TWO ways to answer "I don't know".
#
#         #570 closed the second one: reaching the end of the function with no
#         measurement now BLOCKS, because a gate that measured nothing has failed
#         to answer. But the FIRST branch returns before any measurement is
#         attempted:
#
#             if ! command -v coverage &> /dev/null; then
#               echo "⚠️  coverage.py not available, ..."
#               return 0
#             fi
#
#         That is the same fail-open in an earlier position, and it is the more
#         dangerous one, because "tool not on PATH" is a *steady state* rather
#         than an accident: any consumer repo, CI image or colleague machine
#         without coverage.py on PATH had its Python coverage floor silently
#         switched off, with a ⚠️ that reads as informational.
#
#         The existing issue-570 suite cannot see this: its setup installs a
#         working `coverage` stub precisely so the probe succeeds, so no case ever
#         runs with the tool absent. These cases drive that path directly.
#
#         The one legitimate exception is a subset run (PARTIAL_TEST_RUN=true):
#         nothing was measured because only part of the suite ran, so there is no
#         global total to compare and warning is correct.
# @covers AC-637-01, AC-637-02
bats_require_minimum_version 1.5.0

setup() {
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Run enforce_python_coverage() in an environment where `coverage` cannot
# resolve. PATH is replaced wholesale with one empty directory: prepending an
# empty dir is not enough, because a real coverage.py further down PATH would
# still be found and the probe would take the measured branch instead.
#
#   $1  PARTIAL_TEST_RUN value ("true" or "")
# Prints the function's output; exit status is the function's.
run_without_coverage() {
  local partial="${1:-}"
  local emptybin="$TEST_DIR/emptybin"
  mkdir -p "$emptybin"
  (
    set -u
    cd "$TEST_DIR" || exit 90
    PARTIAL_TEST_RUN="$partial"
    COVERAGE_THRESHOLD=80
    PATH="$emptybin"
    # Anti-vacuity: if the probe were satisfied this case would silently measure
    # the measured branch instead of the branch under test.
    if command -v coverage >/dev/null 2>&1; then
      echo "PRECONDITION-FAILED: coverage is still on PATH"
      exit 89
    fi
    # shellcheck disable=SC1091
    source "$BATS_TEST_DIRNAME/../lib/coverage-total.sh"
    enforce_python_coverage
  )
}

@test "AC-637-01: coverage really is absent for these cases (anti-vacuity)" {
  run run_without_coverage ""

  # 89 is the precondition sentinel. Anything else means the probe genuinely
  # failed to find coverage, which is the state under test.
  [ "$status" -ne 89 ]
  [[ "$output" != *"PRECONDITION-FAILED"* ]]
}

@test "AC-637-01: missing coverage.py BLOCKS instead of warning and returning 0" {
  run run_without_coverage ""

  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
  # The message must name the cause so the developer knows what to install.
  [[ "$output" == *"coverage.py"* ]]
}

@test "AC-637-02: a subset run with missing coverage.py still only warns" {
  # PARTIAL_TEST_RUN means Stage 1 deliberately ran a subset, so there is no
  # global percentage to compare. Blocking here would punish the optimisation the
  # hook itself chose to make.
  run run_without_coverage "true"

  [ "$status" -eq 0 ]
  [[ "$output" != *"BLOCKED"* ]]
}
