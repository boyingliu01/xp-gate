#!/usr/bin/env bash

run_static_analysis() {
  if command -v dart &>/dev/null; then
    dart analyze 2>&1 | sed -n '1,30p; 30q'
    return $?
  else
    echo "Dart SDK not available"
    return 1
  fi
}

run_lint() {
  if command -v dart &>/dev/null; then
    dart format --output=none --set-exit-if-changed . 2>&1 | sed -n '1,30p; 30q'
    return $?
  else
    echo "Dart SDK not available"
    return 1
  fi
}

run_tests() {
  if command -v dart &>/dev/null; then
    dart test 2>&1 | tail -20
    return $?
  else
    echo "Dart SDK not available"
    return 1
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

run_coverage() {
  if command -v dart &>/dev/null; then
    dart test --coverage=coverage 2>&1 | tail -10
    return $?
  else
    echo "Dart SDK not available"
    return 1
  fi
}
