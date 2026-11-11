#!/usr/bin/env bash
# ============================================================================
# gate-7 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# GATE 7: IaC Security Scanning (Terraform, Kubernetes, Docker)
# Extracted to gate-7.sh for maintainability
# v0.14.3+ (Issue #312): Skip if no IaC files changed
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_7_run() {
if any_changed_files_match "\.tf$" "\.tfvars$" "Dockerfile" "\.kube/" "\.ya?ml$"; then
source "$GATE_DIR/gate-7.sh"
else
  echo "✅ PASSED - No IaC files changed, skipping Gate 7."
fi
  return 0
}




# Called by pre-commit's ordered driver.

