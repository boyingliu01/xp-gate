#!/usr/bin/env bash

# Python adapter for quality gates

run_static_analysis() {
  if command -v mypy >/dev/null 2>&1; then
    echo "Running Python static analysis..."
    mypy .
    return $?
  else
    echo "mypy not available, skipping Python static analysis"
    return 0
  fi
}

run_lint() {
  if command -v ruff >/dev/null 2>&1; then
    echo "Running Python linting with ruff..."
    ruff check .
    return $?
  elif command -v flake8 >/dev/null 2>&1; then
    echo "Running Python linting with flake8..."
    flake8 .
    return $?
  else
    echo "No Python linter available, skipping Python linting"
    return 0
  fi
}

run_tests() {
  if command -v pytest >/dev/null 2>&1; then
    echo "Running Python tests..."
    pytest
    return $?
  else
    echo "pytest not available, skipping Python tests"
    return 0
  fi
}

run_coverage() {
  if command -v pytest >/dev/null 2>&1; then
    echo "Running Python coverage..."
    pytest --cov=.
    return $?
  else
    echo "pytest not available, skipping Python coverage"
    return 0
  fi
}