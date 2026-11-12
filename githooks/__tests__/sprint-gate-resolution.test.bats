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

# Concatenate a hook directory's whole chain into one temp file (#798).
# The Gate 11 arm lives in gate-entries/gate-11-entry.sh, so reading pre-commit
# alone would find none of the four tier strings and fail for a layout reason
# rather than a resolution reason.
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

check_resolution_chain() {
  local hook="$1"
  [ -f "$hook" ]

  # One flat candidate list, resolved by the shared library (#476). The four
  # directories below are the contract; the hand-written if/elif chain they used to be
  # written as could not be unit-tested and omitted the canonical global hooks dir.
  run grep -F 'resolve_sprint_gate_script' "$hook"
  [ "$status" -eq 0 ]
  # tier 1: adapters / gate directory
  grep -qF '"$GATE_DIR"' "$hook" || return 1
  # tier 2: project-local githooks/
  grep -qF '/githooks"' "$hook" || return 1
  # tier 3: alongside the hook itself (global installs)
  grep -qF '"$SCRIPT_DIR"' "$hook" || return 1
  # tier 4: the canonical global hooks directory that update-hooks writes to
  grep -qF '"$HOME/.config/xp-gate/hooks"' "$hook" || return 1
}

@test "Gate 11: githooks/pre-commit resolves sprint-gate.sh via all 3 tiers" {
  check_resolution_chain "$GITHOOKS_HOOK"
}

@test "Gate 11: npm-package/hooks/pre-commit resolves sprint-gate.sh via all 3 tiers" {
  check_resolution_chain "$NPM_HOOK"
}
