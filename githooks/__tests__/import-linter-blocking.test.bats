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

setup() {
  GITHOOKS_HOOK="$BATS_TEST_DIRNAME/../pre-commit"
  NPM_HOOK="$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
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
