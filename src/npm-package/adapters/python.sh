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
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | sed -n '1p; 1q')
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
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | sed -n '1p; 1q')
  if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ $ERROR_COUNT test collection/execution errors detected"
    return 1
  fi

  return $PYTEST_EXIT
}
# ── Gate M: Python mutation testing (mutmut) ──

run_mutation() {
  local files_arg="$1"
  local timeout_ms="${2:-120000}"
  local timeout_s=$((timeout_ms / 1000))

  if ! detect_python_mutation_testable; then
    echo "⚠ mutmut not installed. SKIP — Gate M (Python)."
    return 0
  fi

  # Parse comma-separated file list into mutmut --paths-to-mulate args
  local file_list=""
  IFS=',' read -ra FILE_ARRAY <<< "$files_arg"
  for f in "${FILE_ARRAY[@]}"; do
    f=$(echo "$f" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -f "$f" ] && file_list="$file_list $f"
  done

  if [ -z "$file_list" ]; then
    echo "📚 No valid Python source files for mutation. SKIP — Gate M (Python)."
    return 0
  fi

  echo "🐍 Running Python mutation testing (mutmut) on: $file_list"

  # Gate M orchestrator (TypeScript) handles mutmut via MutmutRunner in src/mutation/runners/
  # The shell adapter delegates to the TS runner for consistency with TS Gate M.
  if [ -f "src/mutation/gate-m.ts" ]; then
    timeout "${timeout_s}s" npx tsx src/mutation/gate-m.ts \
      --changed-files "$files_arg" 2>&1
    return $?
  fi

  # Fallback: direct mutmut CLI if TS gate module not available
  local MUTATION_OUTPUT
  MUTATION_OUTPUT=$(mktemp)

  timeout "${timeout_s}s" mutmut run --paths-to-mutate $file_list > "$MUTATION_OUTPUT" 2>&1
  local EXIT_CODE=$?

  cat "$MUTATION_OUTPUT"
  rm -f "$MUTATION_OUTPUT"

  case $EXIT_CODE in
    0)
      echo "✅ Gate M (Python): PASS"
      return 0
      ;;
    124)
      echo "⏱ Gate M (Python): TIMEOUT (${timeout_s}s). Allowing push with warning."
      return 0
      ;;
    *)
      echo "❌ Gate M (Python): mutation score below threshold"
      return 1
      ;;
  esac
}
