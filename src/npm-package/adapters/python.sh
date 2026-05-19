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
  PYTEST_OUTPUT=$(pytest --exitfirst --tb=short 2>&1)
  PYTEST_EXIT=$?
  echo "$PYTEST_OUTPUT" | tail -30

  # Check for collection errors (ModuleNotFoundError / ImportError)
  if echo "$PYTEST_OUTPUT" | grep -qi "ModuleNotFoundError\|ImportError"; then
    echo "❌ Python test collection errors detected — modules not importable"
    echo "   Fix: Run 'pip install -e .' or set PYTHONPATH=."
    return 1
  fi

  # Check if no tests were actually collected
  if echo "$PYTEST_OUTPUT" | grep -q "collected 0 items\|no tests ran"; then
    echo "❌ No tests were collected — nothing actually ran"
    return 1
  fi

  # Check for errors in summary line (e.g. "3 errors")
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | head -1)
  if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ $ERROR_COUNT test collection/execution errors detected"
    return 1
  fi

  return $PYTEST_EXIT
}

run_coverage() {
  require_tool pytest "pytest" || return 1

  echo "Running Python coverage..."
  PYTEST_OUTPUT=$(pytest --exitfirst --tb=short --cov=. --cov-fail-under=80 2>&1)
  PYTEST_EXIT=$?
  echo "$PYTEST_OUTPUT" | tail -30

  # Check for collection errors (ModuleNotFoundError / ImportError)
  if echo "$PYTEST_OUTPUT" | grep -qi "ModuleNotFoundError\|ImportError"; then
    echo "❌ Python test collection errors detected — modules not importable"
    echo "   Fix: Run 'pip install -e .' or set PYTHONPATH=."
    return 1
  fi

  # Check if no tests were actually collected
  if echo "$PYTEST_OUTPUT" | grep -q "collected 0 items\|no tests ran"; then
    echo "❌ No tests were collected — nothing actually ran"
    return 1
  fi

  # Check for errors in summary line (e.g. "3 errors")
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | head -1)
  if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ $ERROR_COUNT test collection/execution errors detected"
    return 1
  fi

  return $PYTEST_EXIT
}