#!/usr/bin/env bats

# ============================================================================
# Gate 11 (Sprint Flow): sprint-gate.sh resolution chain must keep all three
# fallback tiers in BOTH shipped copies of the hook.
#
# The shipped npm copy (src/npm-package/hooks/pre-commit) needs the
# $SCRIPT_DIR tier: global installs place sprint-gate.sh next to the hook
# (update-hooks copySprintGate -> hooksDestDir), NOT in the adapters dir that
# $GATE_DIR resolves to. The canonical hook needs it too — syncHooks() copies
# this file byte-identically into the package, so a tier living only in the
# mirror is silently dropped on the next sync (that drift existed before this
# guard).
# ============================================================================

setup() {
  GITHOOKS_HOOK="$BATS_TEST_DIRNAME/../pre-commit"
  NPM_HOOK="$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
}

check_resolution_chain() {
  local hook="$1"
  [ -f "$hook" ]

  # tier 1: adapters / gate directory
  run grep -F 'SPRINT_GATE_SCRIPT="$GATE_DIR/sprint-gate.sh"' "$hook"
  [ "$status" -eq 0 ]
  # tier 2: project-local githooks/
  run grep -F 'githooks/sprint-gate.sh' "$hook"
  [ "$status" -eq 0 ]
  # tier 3: alongside the hook itself (global installs)
  run grep -F 'SPRINT_GATE_SCRIPT="$SCRIPT_DIR/sprint-gate.sh"' "$hook"
  [ "$status" -eq 0 ]
}

@test "Gate 11: githooks/pre-commit resolves sprint-gate.sh via all 3 tiers" {
  check_resolution_chain "$GITHOOKS_HOOK"
}

@test "Gate 11: npm-package/hooks/pre-commit resolves sprint-gate.sh via all 3 tiers" {
  check_resolution_chain "$NPM_HOOK"
}
