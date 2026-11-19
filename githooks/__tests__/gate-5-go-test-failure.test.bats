#!/usr/bin/env bats
#
# @test REQ-GATE5-GO-TEST-FAILURE Gate 5 must block when a Go test FAILS, not
#       only when its coverage percentage is low
# @intent Gate 5's `go` coverage arm ran the suite itself and then threw away the
#         only thing the run had to say:
#
#             go test -coverprofile=coverage.out ./... 2>/dev/null
#             TOTAL_COVERAGE=$(go tool cover -func=coverage.out | ...)
#             if [ -n "$TOTAL_COVERAGE" ] && (( TOTAL_COVERAGE < 80 )); then
#               return 1
#             fi
#             COV_EXIT=$((COV_EXIT || 0))        # <-- unconditional zero
#
#         The exit status of `go test` was never captured, and stderr was
#         discarded. A failing test therefore reached the verdict only through
#         the coverage percentage it happened to leave behind -- and a failing
#         test measures perfectly well. Measured on a fixture whose only test
#         asserts `Add(1,1) == 3` (so it fails, while covering 100% of
#         statements):
#
#             --- FAIL: TestDeliberatelyFailing (0.00s)
#                 math_test.go:7: deliberately failing
#             FAIL    p       0.044s
#             coverage: 100.0% of statements
#             Go coverage: 100.0%
#             PASSED - Coverage check completed.
#
#         A red suite was reported as a pass, and the commit would have landed.
#         This is the "found none" vs "did not evaluate" conflation named in
#         githooks/AGENTS.md, in its most expensive form: the gate ran the tests,
#         saw them fail, and scored it green.
#
#         The `shell` arm two cases below had the identical job and got it right
#         (`COV_EXIT=$((COV_EXIT || $?))`), which is what makes this a defect
#         rather than a design choice.
#
#         Fix shape: capture the exit status, and let a non-zero one reach
#         COV_EXIT. Coverage BELOW threshold still blocks as before; coverage
#         that cannot be computed at all (no coverage.out) must NOT be read as
#         "0% and therefore failing" -- that was the vacuous-block trap.
#
# @covers AC-GATE5-GO-FAIL-01  a failing go test blocks
# @covers AC-GATE5-GO-FAIL-02  a failing go test is not rescued by high coverage
# @covers AC-GATE5-GO-FAIL-03  a passing suite with good coverage still passes
# @covers AC-GATE5-GO-FAIL-04  the failure text is surfaced, not swallowed
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK/bin"
  cd "$WORK" || return 1

  # Stub `go` so the arm's own logic is what is under test, not the Go SDK.
  # GO_TEST_EXIT / GO_TEST_OUT drive the two shapes: a red suite and a green one.
  cat > bin/go <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "test" ]; then
  printf '%s\n' "${GO_TEST_OUT:-ok  	p	0.01s}"
  exit "${GO_TEST_EXIT:-0}"
fi
if [ "$1" = "tool" ] && [ "$2" = "cover" ]; then
  printf 'total:\t(statements)\t%s%%\n' "${GO_COVER_PCT:-100.0}"
  exit 0
fi
exit 0
STUB
  chmod +x bin/go
  PATH="$WORK/bin:$PATH"
  export PATH
}

load_gate() {
  GATE_DIR="$REPO_ROOT/githooks"
  export GATE_DIR
  # shellcheck source=/dev/null
  . "$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

# The arm is extracted so the predicate can be tested without running the whole
# gate (which would execute this repo's suite). If the helper is missing the
# tests must fail loudly rather than pass vacuously.
require_helper() {
  declare -F _gate5_go_coverage_arm >/dev/null 2>&1 || {
    echo "_gate5_go_coverage_arm is not defined: the Go coverage arm is still inline"
    false
  }
}

@test "AC-GATE5-GO-FAIL-01: a failing go test sets a non-zero coverage exit" {
  load_gate
  require_helper
  export GO_TEST_EXIT=1 GO_TEST_OUT="--- FAIL: TestDeliberatelyFailing (0.00s)" GO_COVER_PCT=100.0
  COV_EXIT=0

  run _gate5_go_coverage_arm
  [ "$status" -ne 0 ] || {
    echo "a FAILING go test produced exit 0 -- the suite failed and the gate passed"
    false
  }
}

@test "AC-GATE5-GO-FAIL-02: high coverage does not rescue a failing suite" {
  # The exact measured shape: 100% statement coverage, one red test. Coverage is
  # a property of execution, not of correctness, so it must not be able to
  # outvote the failure.
  load_gate
  require_helper
  export GO_TEST_EXIT=1 GO_TEST_OUT="--- FAIL: TestX" GO_COVER_PCT=100.0
  COV_EXIT=0

  run _gate5_go_coverage_arm
  [ "$status" -ne 0 ] || {
    echo "100% coverage outvoted a failing test"
    false
  }
}

@test "AC-GATE5-GO-FAIL-03: a passing suite with adequate coverage still passes" {
  # The anti-vacuity guard: the fix must not turn every Go project into a block.
  load_gate
  require_helper
  export GO_TEST_EXIT=0 GO_TEST_OUT="ok  	p	0.01s" GO_COVER_PCT=91.2
  COV_EXIT=0

  run _gate5_go_coverage_arm
  [ "$status" -eq 0 ] || {
    echo "a green suite at 91.2% coverage was blocked"
    false
  }
}

@test "AC-GATE5-GO-FAIL-04: a failing suite surfaces the test output" {
  # Discarding stderr is why nobody noticed for so long: the failing test name
  # was printed to the terminal only because `go test` happened to write it to
  # stdout, and the gate's own line said PASSED right below it. The failure must
  # be attributable from the gate's output alone.
  load_gate
  require_helper
  export GO_TEST_EXIT=1 GO_TEST_OUT="--- FAIL: TestDeliberatelyFailing (0.00s)" GO_COVER_PCT=100.0
  COV_EXIT=0

  run _gate5_go_coverage_arm
  printf '%s' "$output" | grep -q "TestDeliberatelyFailing" || {
    echo "the failing test's name never reached the output"
    echo "got: $output"
    false
  }
}
