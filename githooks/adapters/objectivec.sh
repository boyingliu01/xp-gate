#!/usr/bin/env bash

run_static_analysis() {
  if command -v oclint &>/dev/null; then
    oclint-json-compilation-database 2>&1 | head -30
    return $?
  elif command -v clang-tidy &>/dev/null; then
    find . -name "*.m" -o -name "*.mm" -o -name "*.h" | head -20 | xargs clang-tidy 2>&1 | head -30
    return $?
  else
    echo "No Objective-C analysis tools available (oclint/clang-tidy)"
    return 1
  fi
}

run_lint() {
  run_static_analysis
}

run_tests() {
  if [ -f "*.xcodeproj" ] || [ -f "*.xcworkspace" ]; then
    echo "Xcode project detected — use xcodebuild for tests"
    return 1
  else
    echo "No Objective-C test framework detected"
    return 1
  fi
}

run_coverage() {
  if command -v xccov &>/dev/null; then
    xccov view --report 2>&1 | tail -10
    return $?
  else
    echo "No Objective-C coverage tools available"
    return 1
  fi
}
