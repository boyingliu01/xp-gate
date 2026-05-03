#!/usr/bin/env bash

run_static_analysis() {
  if command -v swiftlint &>/dev/null; then
    swiftlint lint 2>&1 | head -30
    return $?
  else
    echo "SwiftLint not available"
    return 1
  fi
}

run_lint() {
  if command -v swiftlint &>/dev/null; then
    swiftlint lint --strict 2>&1 | head -30
    return $?
  else
    echo "SwiftLint not available"
    return 1
  fi
}

run_tests() {
  if command -v swift &>/dev/null && [ -f "Package.swift" ]; then
    swift test 2>&1 | tail -20
    return $?
  elif [ -f "*.xcodeproj" ] || [ -f "*.xcworkspace" ]; then
    echo "Xcode project detected — use xcodebuild for tests"
    return 1
  else
    echo "No Swift test framework detected"
    return 1
  fi
}

run_coverage() {
  if command -v swift &>/dev/null && [ -f "Package.swift" ]; then
    swift test --enable-code-coverage 2>&1 | tail -10
    return $?
  else
    echo "No Swift test framework detected"
    return 1
  fi
}
