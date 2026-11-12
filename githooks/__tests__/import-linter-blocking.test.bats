#!/usr/bin/env bats

# ============================================================================
# Gate 6 (Python): import-linter contract violations must BLOCK the commit.
#
# Before the fix, the Python branch ran `lint-imports 2>&1 | head -20` and
# discarded the exit status — violations were printed but never blocked the
# commit. Config probing also used relative paths for only two carriers, so a
# pyproject.toml [tool.importlinter] project (or a hook that had cd'd to a
# subdir) silently skipped the check.
#
# The fix detects every carrier at $PROJECT_ROOT, runs lint-imports there,
# captures output + exit code, and blocks on non-zero — matching the
# TypeScript branch's baseline-ratchet pattern. These assertions guard the
# behaviour in BOTH shipped copies of the hook.
# ============================================================================

# Concatenate a hook directory's whole chain into one temp file (#798).
# The Python Gate 6 arm lives in gate-entries/gate-6-entry.sh. The
# `[ "$status" -ne 0 ]` assertion below ("the non-blocking form is GONE") would
# pass trivially once the code left pre-commit -- green while checking nothing --
# so both shipped copies are read as full chains.
_chain_file() {
  local dir="$1" out="$2"
  { cat "$dir/pre-commit" "$dir/gate-driver.sh" "$dir"/gate-entries/*.sh 2>/dev/null; } > "$out"
}

setup() {
  GITHOOKS_HOOK="$BATS_TEST_TMPDIR/githooks-chain.sh"
  NPM_HOOK="$BATS_TEST_TMPDIR/npm-chain.sh"
  _chain_file "$BATS_TEST_DIRNAME/.." "$GITHOOKS_HOOK"
  _chain_file "$BATS_TEST_DIRNAME/../../src/npm-package/hooks" "$NPM_HOOK"
}

check_hook() {
  local hook="$1"
  [ -f "$hook" ]

  # --- non-blocking invocation must be GONE -----------------------------
  run grep -F 'lint-imports 2>&1 | head -20' "$hook"
  [ "$status" -ne 0 ]

  # --- output + exit code must be captured, then BLOCK on failure -------
  run grep -F 'LINT_IMPORTS_OUTPUT=$(cd "$PROJECT_ROOT" && lint-imports 2>&1)' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'LINT_IMPORTS_EXIT=$?' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'Python architecture contract violations (import-linter)' "$hook"
  [ "$status" -eq 0 ]

  # --- every import-linter carrier must be detected at $PROJECT_ROOT ----
  run grep -F '"$PROJECT_ROOT/.importlinter"' "$hook"
  [ "$status" -eq 0 ]
  run grep -F 'tool\.importlinter' "$hook"
  [ "$status" -eq 0 ]
}

@test "Gate 6 (python): githooks/pre-commit blocks on import-linter violations" {
  check_hook "$GITHOOKS_HOOK"
}

@test "Gate 6 (python): npm-package/hooks/pre-commit blocks on import-linter violations" {
  check_hook "$NPM_HOOK"
}
