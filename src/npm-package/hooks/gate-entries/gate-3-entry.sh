#!/usr/bin/env bash
# ============================================================================
# gate-3 entry — extracted from pre-commit by scripts/extract-gates.cjs
#
# WHY THIS FILE EXISTS (#798)
#   The gate order used to BE the physical order of blocks in a 6341-line
#   hook, so changing the order meant moving thousands of lines. An attempt at
#   that also moved the hook epilogue, after which every gate past Gate 13
#   silently stopped running while `bash -n`, a line count and five ordering
#   tests all passed. Gate 5a stopped blocking and only a behavioural test
#   noticed. With one file per gate, order is a list of names in
#   pre-commit's GATE_ORDER and cannot detach a body from its position.
#
# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped
# in a function so the gate keeps its own variable scope, and is called from
# pre-commit at the point the driver reaches it. Edit the gate here from now
# on - there is no copy left in the hook.
# ============================================================================

# ============================================================================
# GATE 3: Cyclomatic Complexity Check
# Extracted to gate-3.sh for maintainability
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_3_run() {
#
# A2 gates the SOURCE, not a branch inside gate-3.sh. GATE_DIR resolves through
# three tiers and, on an installed machine, lands on
# ~/.config/xp-gate/adapters/ -- a COPY that predates this change. An edit
# inside gate-N.sh is therefore inert exactly where it matters most, which is
# the same trap githooks/AGENTS.md documents for the hooks themselves (verified:
# a build here reports GATE_DIR=/c/Users/think/.config/xp-gate/adapters, whose
# gate-4.sh has none of this change). Checking here works against either copy.
if gate_enabled 3; then
  source "$GATE_DIR/gate-3.sh"
else
  echo ""
  echo "→ Gate 3: Cyclomatic complexity..."
  echo "⏭️  SKIPPED - Gate 3: Complexity (not selected by XP_GATE_ONLY_GATE)"
  GATE_3_START=$(gate_start_ms)
  GATE_3_STATUS="SKIP"
  GATE_3_REASON="not_selected"
  record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "0" "$GATE_3_START" "not_selected"
fi
  return 0
}



# Called by pre-commit's ordered driver.

