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

# Concatenate a hook directory's whole chain into one temp file.
# #798: the Python arms live in gate-entries/gate-5-entry.sh, not pre-commit. The
#   `grep ... ; [ "$status" -ne 0 ]` assertions below are the dangerous kind --
#   "the buggy form is gone" is trivially TRUE once the code moves elsewhere, so
#   pointing at pre-commit alone would keep these cases green while checking
#   nothing. Reading the full chain keeps both the "is present" and the "is
#   gone" halves honest for both shipped copies.
_chain_file() {
  local dir="$1" out="$2"
  { cat "$dir/pre-commit" "$dir/gate-driver.sh" "$dir"/gate-entries/*.sh 2>/dev/null; } > "$out"
}

setup() {
  GITHOOKS_HOOK="$BATS_TEST_TMPDIR/githooks-chain.sh"
  NPM_HOOK="$BATS_TEST_TMPDIR/npm-chain.sh"
  _chain_file "$BATS_TEST_DIRNAME/.." "$GITHOOKS_HOOK"
  _chain_file "$BATS_TEST_DIRNAME/../../src/npm-package/hooks" "$NPM_HOOK"
  MYPY_LIB="$BATS_TEST_DIRNAME/../lib/python-incremental-typecheck.sh"
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
  #
  # The incremental type-check moved into
  # githooks/lib/python-incremental-typecheck.sh (#534), which receives the list
  # as function ARGUMENTS ("$@") and re-expands it quoted to mypy:
  #     mypy --follow-imports=silent --ignore-missing-imports "${TYPECHECK_FILES[@]}"
  # Asserting the old inline form `mypy ... "${MYPY_ARGS[@]}"` here went red on
  # correct code. What this case is about is whitespace safety, so assert that
  # property on the code that still calls mypy:
  #   - the hook passes the array quoted to the helper, and
  #   - the helper expands its file list quoted.
  run grep -F 'python_typecheck_incremental "${MYPY_ARGS[@]}"' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'mypy --follow-imports=silent --ignore-missing-imports "${TYPECHECK_FILES[@]}"' "$MYPY_LIB"
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
