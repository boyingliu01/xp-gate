#!/usr/bin/env bash
# ============================================================================
# PROJECT_SUBDIR restore — extracted from pre-commit by scripts/extract-gates.cjs
#
# The hook does `cd "$PROJECT_SUBDIR"` before Gate 0 for single-language
# projects and must `cd` back once the gates that need the subdirectory are
# done. This block used to live inside Gate 8's region only because Gate 8
# was the last such gate in the file; once the order is a list, that
# correspondence is gone. The driver sources this file right after the LAST
# gate in GATE_ORDER that is a SUBDIR_GATE, which is derived, not hardcoded.
# ============================================================================

# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
xp_gate_subdir_restore() {
# Switch back to original directory if we were in a subdirectory
if [ -n "$ORIGINAL_DIR" ]; then
  cd "$ORIGINAL_DIR" 
fi
  return 0
}



# Sourced by pre-commit's ordered driver after the last subdir gate.

