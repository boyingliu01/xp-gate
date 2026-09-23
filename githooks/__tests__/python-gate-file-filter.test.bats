#!/usr/bin/env bats

# ============================================================================
# Issue #412: Python ruff/mypy gates must filter staged files to *.py
#
# Before the fix, Gate 1 (Python) handed the raw staged-file list to ruff/mypy:
#   ruff check "$CHANGED_FILES"                          (quoted -> one arg;
#                                                        non-.py parsed as Py)
#   mypy ... $(echo "$CHANGED_FILES" | grep "\.py$" || echo ".")
#                                                        (no .py staged -> scans
#                                                         the WHOLE project)
# Either one BLOCKS a docs/YAML/config-only commit with false errors.
#
# The fix filters to *.py and skips the tool when none are staged, matching the
# format/debug/shell gates. These assertions guard against regressing that, in
# BOTH shipped copies of the hook.
# ============================================================================

setup() {
  GITHOOKS_HOOK="$BATS_TEST_DIRNAME/../pre-commit"
  NPM_HOOK="$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
}

check_hook() {
  local hook="$1"
  [ -f "$hook" ]

  # --- ruff gate: buggy unfiltered invocation must be GONE --------------
  run grep -F 'ruff check "$CHANGED_FILES"' "$hook"
  [ "$status" -ne 0 ]
  # --- ruff gate: fixed filtered invocation must be PRESENT -------------
  run grep -F 'PY_LINT_FILES=$(echo "$CHANGED_FILES" | grep' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'ruff check $PY_LINT_FILES' "$hook"
  [ "$status" -eq 0 ]

  # --- mypy gate: buggy whole-project fallback must be GONE -------------
  run grep -F 'mypy --ignore-missing-imports $(echo' "$hook"
  [ "$status" -ne 0 ]
  # --- mypy gate: fixed filtered invocation must be PRESENT -------------
  run grep -F 'PY_MYPY_FILES=$(echo "$CHANGED_FILES" | grep' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'mypy --ignore-missing-imports $PY_MYPY_FILES' "$hook"
  [ "$status" -eq 0 ]
}

@test "Issue #412: githooks/pre-commit filters ruff & mypy to *.py" {
  check_hook "$GITHOOKS_HOOK"
}

@test "Issue #412: npm-package/hooks/pre-commit filters ruff & mypy to *.py" {
  check_hook "$NPM_HOOK"
}
