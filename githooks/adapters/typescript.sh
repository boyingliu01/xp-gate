#!/usr/bin/env bash

# TypeScript adapter for quality gates

run_static_analysis() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript static analysis..."
    npx tsc --noEmit
    return $?
  else
    echo "npx not available, skipping TypeScript static analysis"
    return 0
  fi
}

run_lint() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript linting..."
    npx eslint . --ext .ts,.tsx
    return $?
  else
    echo "npx not available, skipping TypeScript linting"
    return 0
  fi
}

run_tests() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript tests..."
    if npx vitest --version >/dev/null 2>&1; then
      npx vitest run
    elif npx jest --version >/dev/null 2>&1; then
      npx jest --passWithNoTests
    else
      echo "No test runner available (vitest or jest required)"
      return 1
    fi
    return $?
  else
    echo "npx not available, skipping TypeScript tests"
    return 0
  fi
}

run_coverage() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript coverage..."
    if npx vitest --version >/dev/null 2>&1; then
      npx vitest run --coverage
    elif npx jest --version >/dev/null 2>&1; then
      npx jest --coverage
    else
      echo "No test runner available for coverage"
      return 1
    fi
    return $?
  else
    echo "npx not available, skipping TypeScript coverage"
    return 0
  fi
}