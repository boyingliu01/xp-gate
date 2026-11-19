#!/usr/bin/env bash

# Swift adapter.
#
# VERDICT CONTRACT (#806 G1a): Gate 1 reads these exit codes as
#   0 = PASS / 1|2 = BLOCK (findings or fail-closed) / 3 = WARN, NOT verified
#
# "Tool not installed" is 3, never 1.
#
# Measured 2026-11-20, language matrix, swift fixture on a machine without
# SwiftLint:
#
#     -> Gate 1: Code Quality
#        -- Checking swift --
#        Running static analysis for swift...
#        SwiftLint not available
#        Running lint check for swift...
#        SwiftLint not available
#        BLOCKED - swift code quality violations (fix or add suppressions)
#        chain stopped at Gate 1 -- gates 2 3 8 10 7 5 6 4 never reached
#
# Both functions returned 1, and Gate 1 reads 1 as "the analyzer found problems".
# A machine without SwiftLint therefore blocked EVERY Swift commit with a message
# claiming code-quality violations that no tool had looked for -- and it stopped
# the chain, so eight later gates never ran either.
#
# This is the inverse of the usual defect in this series. The others reported a
# pass they had not earned; this one reports a failure it did not find. Both come
# from the same place: an exit code chosen for its value rather than for what the
# caller does with it.
#
# The reason is emitted as XP_G1_REASON, which Gate 1 lifts out of the output and
# stores as GATE_1_DETAIL -- without it the WARN would be as unreasoned as the
# BLOCK was.

run_static_analysis() {
  if command -v swiftlint &>/dev/null; then
    swiftlint lint 2>&1 | sed -n '1,30p; 30q'
    return "${PIPESTATUS[0]}"
  fi
  # 3 = "did not evaluate", not "found problems".
  echo "XP_G1_REASON: swift: SwiftLint not installed -- nothing was linted"
  echo "SwiftLint not available (install: brew install swiftlint)"
  return 3
}

run_lint() {
  if command -v swiftlint &>/dev/null; then
    swiftlint lint --strict 2>&1 | sed -n '1,30p; 30q'
    return "${PIPESTATUS[0]}"
  fi
  echo "XP_G1_REASON: swift: SwiftLint not installed -- strict lint not run"
  echo "SwiftLint not available (install: brew install swiftlint)"
  return 3
}

# run_tests / run_coverage keep returning non-zero when there is genuinely nothing
# to run: Gate 5's contract distinguishes "tests failed" (block) from "no tests"
# through its own skip markers, and a non-zero here is the "could not run" signal
# it already understands. Only the two Gate 1 arms above needed changing, because
# only Gate 1 maps a bare 1 to "violations found".
run_tests() {
  if command -v swift &>/dev/null && [ -f "Package.swift" ]; then
    swift test 2>&1 | tail -20
    return "${PIPESTATUS[0]}"
  elif [ -f "*.xcodeproj" ] || [ -f "*.xcworkspace" ]; then
    echo "Xcode project detected — use xcodebuild for tests"
    return 1
  else
    echo "No Swift test framework detected"
    return 1
  fi
}

# #798 / #794: does run_coverage() also execute AND validate the test suite?
# Yes: `swift test --enable-code-coverage` runs the same suite and reports the
# same failures, so a separate run_tests() pass adds no verdict -- only time.
# Undeclared adapters keep the safe double-run default.
coverage_runs_tests() { return 0; }

run_coverage() {
  if command -v swift &>/dev/null && [ -f "Package.swift" ]; then
    swift test --enable-code-coverage 2>&1 | tail -10
    return "${PIPESTATUS[0]}"
  else
    echo "No Swift test framework detected"
    return 1
  fi
}
