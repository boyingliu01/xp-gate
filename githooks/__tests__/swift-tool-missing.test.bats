#!/usr/bin/env bats
#
# @test REQ-SWIFT-NOTOOL a missing SwiftLint is "not verified", not "violations found"
# @intent Gate 1 maps an adapter's exit code onto a verdict:
#
#       0      -> PASS
#       1 or 2 -> BLOCK (findings, or fail-closed)
#       3      -> WARN, NOT verified
#
#       swift.sh returned 1 from both run_static_analysis and run_lint when
#       SwiftLint was absent. Gate 1 reads 1 as "the analyzer found problems", so a
#       machine without SwiftLint blocked EVERY Swift commit -- and because Gate 1
#       blocks, the chain stopped there.
#
#       Measured 2026-11-20, language matrix, swift fixture without SwiftLint:
#
#           Running static analysis for swift...
#           SwiftLint not available
#           Running lint check for swift...
#           SwiftLint not available
#           BLOCKED - swift code quality violations (fix or add suppressions)
#           chain stopped at Gate 1 -- gates 2 3 8 10 7 5 6 4 never reached
#
#       Two separate harms in one line of output: a clean project reported as dirty,
#       and eight later gates silently not run.
#
#       This is the INVERSE of the usual defect in this series. The others reported
#       a pass nobody had earned; this reported a failure nobody had found. The
#       common cause is an exit code chosen for its value rather than for what the
#       caller does with it.
#
# @covers AC-SWIFT-NT-01  run_static_analysis returns 3 (not 1) without SwiftLint
# @covers AC-SWIFT-NT-02  run_lint returns 3 (not 1) without SwiftLint
# @covers AC-SWIFT-NT-03  the skip carries a reason Gate 1 can lift out
# @covers AC-SWIFT-NT-04  a present SwiftLint still reports its own failures as 1
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO/githooks/adapters/swift.sh"
}

_has_swiftlint() { command -v swiftlint >/dev/null 2>&1; }

@test "AC-SWIFT-NT-01: run_static_analysis returns 3 without SwiftLint" {
  _has_swiftlint && skip "SwiftLint IS installed here; this asserts the absent path"

  run bash -c '
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    run_static_analysis >/dev/null 2>&1
    echo "RC=$?"
  ' _ "$ADAPTER"

  printf '%s' "$output" | grep -q 'RC=3' || {
    echo "run_static_analysis did not return 3 for a missing tool:"
    printf '%s\n' "$output"
    echo "-> Gate 1 reads 1 as 'violations found' and blocks the commit"
    false
  }
}

@test "AC-SWIFT-NT-02: run_lint returns 3 without SwiftLint" {
  _has_swiftlint && skip "SwiftLint IS installed here; this asserts the absent path"

  run bash -c '
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    run_lint >/dev/null 2>&1
    echo "RC=$?"
  ' _ "$ADAPTER"

  printf '%s' "$output" | grep -q 'RC=3' || {
    echo "run_lint did not return 3 for a missing tool:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-SWIFT-NT-03: the skip carries a reason Gate 1 can lift out" {
  _has_swiftlint && skip "SwiftLint IS installed here; this asserts the absent path"

  # Gate 1 extracts lines matching '^XP_G1_REASON: ' and stores them as
  # GATE_1_DETAIL. Without one the WARN is as unreasoned as the BLOCK was.
  run bash -c '
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    run_static_analysis 2>&1
  ' _ "$ADAPTER"

  printf '%s' "$output" | grep -q '^XP_G1_REASON: ' || {
    echo "no XP_G1_REASON line, so GATE_1_DETAIL stays empty:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-SWIFT-NT-04: a present SwiftLint still reports its own failures" {
  # Anti-over-reach. Hard-coding 3 for every outcome would make the gate unable to
  # fail at all -- a stub that always says "not verified" is not a check.
  grep -q 'command -v swiftlint' "$ADAPTER" || {
    echo "the adapter no longer looks for SwiftLint before deciding"
    false
  }
  # The success path must return the TOOL's status, not a constant.
  grep -qE 'return "\$\{PIPESTATUS\[0\]\}"|return \$PIPESTATUS\[0\]' "$ADAPTER" || {
    echo "the SwiftLint path no longer returns the tool's own exit status:"
    grep -n 'swiftlint lint' -A2 "$ADAPTER" | head -6
    false
  }
}
