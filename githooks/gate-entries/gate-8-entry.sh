#!/usr/bin/env bash
# ============================================================================
# gate-8 entry — extracted from pre-commit by scripts/extract-gates.cjs
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

# GATE 8: Secret Scanning (gitleaks)
# Extracted to gate-8.sh for maintainability
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_8_run() {
# #806 G8x: the deselect arm set GATE_8_STATUS and returned without a journal
# line. This is the fail-closed security gate, so an unrecorded skip is the worst
# place to have one: "secret scanning was not selected" and "secret scanning does
# not exist in this chain" must not look the same. The delegate
# ($GATE_DIR/gate-8.sh) records its own verdicts; only this arm was silent.
GATE_8_START=$(gate_start_ms)
if ! gate_enabled 8; then
  echo "⏭️  SKIPPED - Gate 8: Secret scanning (not selected by XP_GATE_ONLY_GATE)"
  GATE_8_STATUS="SKIP"
  GATE_8_DETAIL="not_selected"
  record_gate_audit "gate-8" "secret-scanning" "$GATE_8_STATUS" "0" "$GATE_8_START"
  return 0
fi

source "$GATE_DIR/gate-8.sh"
  return 0
}


# Called by pre-commit's ordered driver.

