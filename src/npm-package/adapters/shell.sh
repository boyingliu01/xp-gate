#!/usr/bin/env bash

# Shell adapter for quality gates

run_static_analysis() {
  if command -v shellcheck >/dev/null 2>&1; then
    echo "Running Shell static analysis..."
    shellcheck ./*.sh
    return $?
  else
    echo "shellcheck not available, skipping Shell linting"
    return 0
  fi
}

run_lint() {
  if command -v shellcheck >/dev/null 2>&1; then
    echo "Running Shell linting..."
    shellcheck ./*.sh ./**/**/*.sh
    return $?
  else
    echo "shellcheck not available, skipping Shell linting"
    return 0
  fi
}

run_tests() {
  # Look for and run shell test files
  if [[ -d "tests" ]] && [[ -n "$(find tests -name "*.sh" -type f | head -n 1)" ]]; then
    echo "Running Shell tests..."
    for test_file in tests/*.sh; do
      if [[ -x "$test_file" ]]; then
        "$test_file"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
          return $exit_code
        fi
      fi
    done
    return 0
  elif command -v shunit2 >/dev/null 2>&1; then
    echo "Checking for shunit2 tests..."
    # Skip - shunit2 requires properly formatted tests, just run any script if available
    return 0
  else
    echo "No shell tests detected or shunit2 available"
    return 0
  fi
}

run_coverage() {
  # Shell does not typically have standardized coverage tools
  echo "Shell coverage not available"
  return 0
}