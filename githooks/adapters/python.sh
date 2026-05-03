#!/usr/bin/env bash

# Python adapter for quality gates
# Tools: mypy, ruff/flake8, pytest, import-linter (architecture)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../adapter-common.sh" 2>/dev/null || true

run_static_analysis() {
  require_tool mypy "mypy" || return 1

  echo "Running Python static analysis (mypy)..."
  mypy .
  return $?
}

run_lint() {
  if command -v ruff >/dev/null 2>&1; then
    echo "Running Python linting (ruff)..."
    ruff check .
    return $?
  elif command -v flake8 >/dev/null 2>&1; then
    echo "Running Python linting (flake8)..."
    flake8 .
    return $?
  else
    echo "⚠ No Python linter available (ruff or flake8 required)"
    return 0
  fi
}

run_architecture() {
  if [ ! -f ".import-linter.yml" ] && [ ! -f "import_linter_config.yml" ]; then
    return 0
  fi

  require_tool lint-imports "import-linter" || return 0

  echo "Running Python architecture checks (import-linter)..."
  lint-imports
  return $?
}

run_tests() {
  require_tool pytest "pytest" || return 1

  echo "Running Python tests..."
  pytest
  return $?
}

run_coverage() {
  require_tool pytest "pytest" || return 1

  echo "Running Python coverage..."
  pytest --cov=.
  return $?
}