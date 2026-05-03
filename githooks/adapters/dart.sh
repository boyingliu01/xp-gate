#!/usr/bin/env bash

run_static_analysis() {
  if command -v dart &>/dev/null; then
    dart analyze 2>&1 | head -30
    return $?
  else
    echo "Dart SDK not available"
    return 1
  fi
}

run_lint() {
  if command -v dart &>/dev/null; then
    dart format --output=none --set-exit-if-changed . 2>&1 | head -30
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

run_coverage() {
  if command -v dart &>/dev/null; then
    dart test --coverage=coverage 2>&1 | tail -10
    return $?
  else
    echo "Dart SDK not available"
    return 1
  fi
}
