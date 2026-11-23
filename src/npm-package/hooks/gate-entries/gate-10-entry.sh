#!/usr/bin/env bash
# ============================================================================
# gate-10 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 10: Semgrep SAST Security Scan
# Extracted to gate-10.sh for maintainability
# v0.14.3+ (Issue #312): Skip if no code files changed
# v0.18.5 (Issue #397): Fix gate status variable collision — SAST now sets GATE_10_STATUS
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_10_run() {
# #806 G10x: the SKIP arm below set GATE_10_STATUS and returned without a journal
# line. The gate's real work is delegated to $GATE_DIR/gate-10.sh, which records
# its own verdict -- so every path that does NOT reach it (deselected, script
# missing, nothing to scan) left no trace at all. Measured: `xp-gate audit` holds
# thousands of gate-10 rows and none of them came from these three arms, which
# made "skipped" and "never ran" the same thing. One start stamp, recorded in
# each arm that returns before the delegate.
# Measured 2026-11-23: 125 of 146 gate-10 SKIP rows in .xp-gate/audit.jsonl had
# NO detail. Both arms below computed a reason and neither passed it:
#
#   - the not-selected arm set GATE_10_DETAIL but the audit call took only five
#     arguments, so the value was dropped one line after being set
#   - the two arms below set GATE_10_REASON, a variable record_gate_audit never
#     reads (its 6th argument is the detail), so both reasons were invisible
#
# Three ways to compute a reason, zero of them reaching the journal -- the
# "computed, never connected" defect, three times in a 70-line file.
GATE_10_START=$(gate_start_ms)
if ! gate_enabled 10; then
  echo "⏭️  SKIPPED - Gate 10: SAST security (not selected by XP_GATE_ONLY_GATE)"
  GATE_10_STATUS="SKIP"
  GATE_10_DETAIL="not_selected"
  record_gate_audit "gate-10" "sast" "$GATE_10_STATUS" "0" "$GATE_10_START" "$GATE_10_DETAIL"
  return 0
fi

if any_changed_files_match "\.(ts|tsx|js|jsx|py|go|java|kt|cpp|c|swift|m|dart|sh|ps1|psm1|cs|csx|fs|vb|rs|php|rb|lua|pl)$"; then
  if [ -f "$GATE_DIR/gate-10.sh" ]; then
    source "$GATE_DIR/gate-10.sh"
  else
    echo "⏭️  SKIPPED - SAST (gate-10.sh not found)"
    GATE_10_STATUS="SKIP"
    GATE_10_REASON="gate_script_missing"
    record_gate_audit "gate-10" "sast" "$GATE_10_STATUS" "0" "$GATE_10_START" "$GATE_10_REASON"
  fi
else
  echo "⏭️  SKIPPED - No code files changed, skipping SAST scan."
  # #536: "nothing to scan" is NOT "scanned and clean". Record SKIP with a
  # reason so the quality report never renders this path as a PASS claim.
  GATE_10_STATUS="SKIP"
  GATE_10_REASON="no_code_files_changed"
  record_gate_audit "gate-10" "sast" "$GATE_10_STATUS" "0" "$GATE_10_START" "$GATE_10_REASON"
fi
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

