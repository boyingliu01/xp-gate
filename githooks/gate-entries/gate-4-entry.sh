#!/usr/bin/env bash
# ============================================================================
# gate-4 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 4: Principles Checker (Clean Code + SOLID)
# Extracted to gate-4.sh for maintainability
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_4_run() {
if gate_enabled 4; then
  source "$GATE_DIR/gate-4.sh"
else
  echo ""
  echo "→ Gate 4: Principles checker..."
  echo "⏭️  SKIPPED - Gate 4: Principles (not selected by XP_GATE_ONLY_GATE)"
  GATE_4_START=$(gate_start_ms)
  GATE_4_STATUS="SKIP"
  GATE_4_REASON="not_selected"
  WARNING_COUNT=0
  record_gate_audit "gate-4" "principles" "$GATE_4_STATUS" "0" "$GATE_4_START" "not_selected"
fi
  return 0
}



# Called by pre-commit's ordered driver.

