#!/usr/bin/env bash

# Go adapter for quality gates

run_static_analysis() {
  if command -v go >/dev/null 2>&1; then
    echo "Running Go static analysis..."
    go vet ./...
    return $?
  else
    echo "go not available, skipping Go static analysis"
    return 1
  fi
}

run_lint() {
  if command -v golangci-lint >/dev/null 2>&1; then
    echo "Running Go linting..."
    golangci-lint run
    return $?
  else
    echo "golangci-lint not available, skipping Go linting"
    return 0
  fi
}

run_tests() {
  if command -v go >/dev/null 2>&1; then
    echo "Running Go tests..."
    go test ./...
    return $?
  else
    echo "go not available, skipping Go tests"
    return 1
  fi
}

run_coverage() {
  if command -v go >/dev/null 2>&1; then
    echo "Running Go coverage..."
    go test -coverprofile=coverage.out ./...
    return $?
  else
    echo "go not available, skipping Go coverage"
    return 1
  fi
}