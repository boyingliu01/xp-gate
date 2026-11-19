#!/usr/bin/env bash

run_static_analysis() {
  if command -v dart &>/dev/null; then
    dart analyze 2>&1 | sed -n '1,30p; 30q'
    return "${PIPESTATUS[0]}"
  else
    echo "XP_G1_REASON: dart: Dart SDK not installed -- nothing was checked"
    echo "Dart SDK not available"
    return 3
  fi
}

run_lint() {
  if command -v dart &>/dev/null; then
    dart format --output=none --set-exit-if-changed . 2>&1 | sed -n '1,30p; 30q'
    return "${PIPESTATUS[0]}"
  else
    echo "XP_G1_REASON: dart: Dart SDK not installed -- nothing was checked"
    echo "Dart SDK not available"
    return 3
  fi
}

run_tests() {
  if command -v dart &>/dev/null; then
    dart test 2>&1 | tail -20
    return "${PIPESTATUS[0]}"
  else
    echo "XP_G1_REASON: dart: Dart SDK not installed -- nothing was checked"
    echo "Dart SDK not available"
    return 3
  fi
}

# #798 / #794: does run_coverage() also execute AND validate the test suite?
#
# Yes here: `dart test --coverage=coverage` runs every test exactly as
# run_tests() does and reports failures the same way, so the coverage pass
# carries all the information a separate test pass would. Declaring this lets
# Gate 5 run the suite ONCE instead of twice (#794 measured 28.5s + 30.0s for
# two near-identical runs on a 319-test project).
#
# This declaration is what removes the need for a language special case in the
# hook. An adapter that does NOT declare stays on the safe double-run default:
# slower, but never silently dropping test verification.
coverage_runs_tests() { return 0; }

# Gate 13 capability: `dart analyze` type-checks the project. Measured
# 2026-11-19: exits 0 on clean code, 3 on a type error -- and it reports type
# mismatches that no other gate in this chain looks for in Dart.
compiler_check_command() { printf "%s" "dart analyze"; }

run_coverage() {
  if command -v dart &>/dev/null; then
    dart test --coverage=coverage 2>&1 | tail -10
    return "${PIPESTATUS[0]}"
  else
    echo "XP_G1_REASON: dart: Dart SDK not installed -- nothing was checked"
    echo "Dart SDK not available"
    return 3
  fi
}
