#!/usr/bin/env bash

run_static_analysis() {
  if command -v flutter &>/dev/null; then
    flutter analyze 2>&1 | head -30
    return $?
  else
    echo "Flutter SDK not available"
    return 1
  fi
}

run_lint() {
  if command -v flutter &>/dev/null; then
    flutter format --output=none --set-exit-if-changed . 2>&1 | head -30
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
