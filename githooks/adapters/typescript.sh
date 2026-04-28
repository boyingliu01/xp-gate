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
    npx jest --passWithNoTests
    return $?
  else
    echo "npx not available, skipping TypeScript tests"
    return 0
  fi
}

run_coverage() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript coverage..."
    npx jest --coverage
    return $?
  else
    echo "npx not available, skipping TypeScript coverage"
    return 0
  fi
}