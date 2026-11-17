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
if ! gate_enabled 12; then
  echo "⏭️  SKIPPED - Gate 12: File hygiene (not selected by XP_GATE_ONLY_GATE)"
  # No GATE_12_DETAIL here (removed with #806 G12a): pre-commit's blocking-exit
  # journal reads GATE_<id>_DETAIL, but only on a blocking exit, and Gate 12 is
  # non-blocking -- so a detail variable for this gate is write-only. Gate 0/1
  # populate one legitimately because they CAN block.
  GATE_12_STATUS="SKIP"
  return 0
fi

if [ -f "$GATE_DIR/gate-12-file-hygiene.sh" ]; then
  source "$GATE_DIR/gate-12-file-hygiene.sh"
elif [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/githooks/gate-12-file-hygiene.sh" ]; then
  # shellcheck source=/dev/null
  # Above: the path is only known at runtime (git rev-parse), so shellcheck
  # cannot follow it and reports SC1090/SC1091. The guard on the preceding
  # `elif` already proves the file exists, so this is a static-analysis
  # limitation, not an unchecked source.
  source "$(git rev-parse --show-toplevel)/githooks/gate-12-file-hygiene.sh"
else
  # #806 G12a: this arm printed SKIPPED and stopped there, so GATE_12_STATUS kept
  # whatever the driver left in it -- measured PASS -- and record_gate_audit was
  # never called, meaning the gate left NO journal line at all. A gate that wrote
  # nothing is indistinguishable from a gate the chain never contained, and the
  # operator was told "SKIPPED" while the machine recorded a pass.
  #
  # Same family as #806 G1a (Gate 1's four SKIP sites) and #806 D2 (Gate 0's
  # --skip-version-check arm): the words said SKIP, the state said PASS.
  echo "⏭️  SKIPPED - Gate 12: File Hygiene (gate-12-file-hygiene.sh not found)"
  GATE_12_STATUS="SKIP"
  GATE_12_START=$(gate_start_ms)
  record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "0" "$GATE_12_START"
fi
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

