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
if any_changed_files_match "\.(ts|tsx|js|jsx|py|go|java|kt|cpp|c|swift|m|dart|sh|ps1|psm1|cs|csx|fs|vb|rs|php|rb|lua|pl)$"; then
  if [ -f "$GATE_DIR/gate-10.sh" ]; then
    source "$GATE_DIR/gate-10.sh"
  else
    echo "⏭️  SKIPPED - SAST (gate-10.sh not found)"
    GATE_10_STATUS="SKIP"
    GATE_10_REASON="gate_script_missing"
  fi
else
  echo "⏭️  SKIPPED - No code files changed, skipping SAST scan."
  # #536: "nothing to scan" is NOT "scanned and clean". Record SKIP with a
  # reason so the quality report never renders this path as a PASS claim.
  GATE_10_STATUS="SKIP"
  GATE_10_REASON="no_code_files_changed"
fi
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

