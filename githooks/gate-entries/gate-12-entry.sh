#!/usr/bin/env bash
# ============================================================================
# gate-12 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 12: File Hygiene Check
# Detects trailing whitespace, missing EOF newlines, merge conflict markers,
# and oversized files in staged changes.
# v0.14.15+ (Issue #350, #351)
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_12_run() {
if [ -f "$GATE_DIR/gate-12-file-hygiene.sh" ]; then
  source "$GATE_DIR/gate-12-file-hygiene.sh"
elif [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/githooks/gate-12-file-hygiene.sh" ]; then
  source "$(git rev-parse --show-toplevel)/githooks/gate-12-file-hygiene.sh"
else
  echo "⏭️  SKIPPED - Gate 12: File Hygiene (gate-12-file-hygiene.sh not found)"
fi
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

