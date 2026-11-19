#!/usr/bin/env bash

run_static_analysis() {
  if command -v flutter &>/dev/null; then
    flutter analyze 2>&1 | sed -n '1,30p; 30q'
    return $?
  else
    echo "Flutter SDK not available"
    return 1
  fi
}

run_lint() {
  if command -v flutter &>/dev/null; then
    flutter format --output=none --set-exit-if-changed . 2>&1 | sed -n '1,30p; 30q'
    return $?
  else
    echo "Flutter SDK not available"
    return 1
  fi
}

run_tests() {
  if command -v flutter &>/dev/null; then
    flutter test 2>&1 | tail -20
    return $?
  else
    echo "Flutter SDK not available"
    return 1
  fi
}

run_coverage() {
  if command -v flutter &>/dev/null; then
    flutter test --coverage 2>&1 | tail -10
    return $?
  else
    echo "Flutter SDK not available"
    return 1
  fi
}

# Gate 13 capability: type-check with `dart analyze`.
#
# Added 2026-11-19 after the matrix showed the dart dirty row as G13=SKIP even
# though dart.sh declares exactly this. The cause was the LANGUAGE NAME, not the
# adapter: a project with a pubspec.yaml is detected as `flutter` (measured:
# `xp-gate detect-languages` prints "Flutter (flutter), Config files: pubspec.yaml"),
# so Gate 13 asked flutter.sh for the declaration and found none.
#
#   lib/a.dart : int f() { return "not an int"; }
#   dart analyze: error - A value of type 'String' can't be returned ... - return_of_invalid_type
#   gate 13     : SKIPPED (no compiler declared) -> commit ALLOWED
#
# The same Dart source was type-checked or not depending on which of two adapters
# the detector picked for it. `dart analyze` is the same command either way, and a
# Flutter project is a Dart project with a UI framework on top -- so the capability
# belongs to both, declared in both, rather than to whichever name won detection.
#
# Gate 1 for Flutter keeps using `flutter analyze` (it understands widget files);
# this is Gate 13's compile-time question, which `dart analyze` answers for both.
compiler_check_command() { printf "%s" "dart analyze"; }
