#!/usr/bin/env bats

# ============================================================================
# Whitespace-safe file lists for the Python ruff/mypy gates
#
# Issue #412 filtered the staged list to *.py, but still hands the tools an
# UNQUOTED multiline variable:
#   ruff check $PY_LINT_FILES
#   mypy --ignore-missing-imports $PY_MYPY_FILES
# Bash word-splits on every whitespace, so any staged path containing a space
# (common on Windows: "My Documents/file.py") is split into nonexistent
# arguments and the gate fails with false E902 errors.
#
# The fix builds bash arrays and expands them quoted ("${RUFF_ARGS[@]}"),
# giving one argument per path regardless of spaces. It also accepts *.pyi
# stub files, which the '\.py$' grep silently dropped. These assertions guard
# BOTH shipped copies of the hook.
# ============================================================================

setup() {
  GITHOOKS_HOOK="$BATS_TEST_DIRNAME/../pre-commit"
  NPM_HOOK="$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
}

check_hook() {
  local hook="$1"
  [ -f "$hook" ]

  # --- ruff gate: buggy unquoted expansion must be GONE ------------------
  run grep -F 'ruff check $PY_LINT_FILES' "$hook"
  [ "$status" -ne 0 ]
  # --- ruff gate: array-based quoted expansion must be PRESENT -----------
  run grep -F 'ruff check "${RUFF_ARGS[@]}"' "$hook"
  [ "$status" -eq 0 ]

  # --- mypy gate: buggy unquoted expansion must be GONE ------------------
  run grep -F 'mypy --ignore-missing-imports $PY_MYPY_FILES' "$hook"
  [ "$status" -ne 0 ]
  # --- mypy gate: array-based quoted expansion must be PRESENT -----------
  run grep -F 'mypy --ignore-missing-imports "${MYPY_ARGS[@]}"' "$hook"
  [ "$status" -eq 0 ]

  # --- both gates accept .pyi stubs ---------------------------------------
  run grep -F '*.py|*.pyi)' "$hook"
  [ "$status" -eq 0 ]

  # --- format gate: buggy unquoted expansion must be GONE ------------------
  run grep -F 'ruff format --check $PY_FMT_FILES' "$hook"
  [ "$status" -ne 0 ]
  run grep -F 'ruff format --check "${FMT_ARGS[@]}"' "$hook"
  [ "$status" -eq 0 ]

  # --- debug-statement gate: buggy unquoted expansion must be GONE ---------
  run grep -F "ipdb' \$PY_DEBUG_FILES" "$hook"
  [ "$status" -ne 0 ]
  run grep -F "ipdb' \"\${DEBUG_ARGS[@]}\"" "$hook"
  [ "$status" -eq 0 ]
}

@test "whitespace-safe: githooks/pre-commit passes py files as arrays" {
  check_hook "$GITHOOKS_HOOK"
}

@test "whitespace-safe: npm-package/hooks/pre-commit passes py files as arrays" {
  check_hook "$NPM_HOOK"
}
