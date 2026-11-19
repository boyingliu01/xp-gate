#!/usr/bin/env bats
#
# @test REQ-GATE5C-SKIP-RECORDED
# @intent Gate 5c computes a verdict and nobody reads it.
#
#         The alignment check in githooks/lib/gate-5c-alignment.sh sets
#         GATE_5C_STATUS to exactly one of PASS, SKIP or BLOCK on every path, and
#         its own header states the rule: "GATE_5C_STATUS is now always PASS,
#         SKIP or BLOCK — never empty", because a previous revision printed
#         nothing at all on a fresh clone and silence read as success (#585).
#
#         Measured: NOTHING outside gate-5c-alignment.sh reads that variable.
#
#             grep -rn GATE_5C_STATUS githooks/pre-commit githooks/gate-driver.sh \
#                 githooks/lib/*.sh
#             -> (no matches)
#
#         So three of the four paths lost their verdict:
#
#             BLOCK   still blocks, because gate_5c_alignment returns 1 and the
#                     gate body does `|| return 1`. That one is fine.
#             SKIP    prints a reason to the console, and the audit row records
#                     only GATE_5_DETAIL -- which 5c never sets. The journal
#                     therefore shows a bare gate-5 row that cannot distinguish
#                     "alignment was clean" from "alignment never ran".
#             PASS    same, indistinguishable.
#
#         This is the recurring failure of this codebase, named in both AGENTS
#         files: "SKIP must be recorded, not merely printed", and 'a gate that
#         cannot run must set GATE_N_STATUS="SKIP" AND write an audit line'. A
#         console line is not a record.
#
#         The three SKIP arms that need recording, from the source:
#             req-ids.json missing           (fresh clone: .sprint-state is ignored)
#             jq missing                     (tool unavailable)
#             no test files among the staged changes
#
#         Each must reach the journal as a distinct reason, because "no test
#         files staged" is a legitimate, expected outcome while "jq is not
#         installed" is an environment fault the operator needs to fix.
#
# @covers AC-GATE5C-SKIP-01 AC-GATE5C-SKIP-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ALIGN="$REPO/githooks/lib/gate-5c-alignment.sh"
  ENTRY="$REPO/githooks/gate-entries/gate-5-entry.sh"
}

@test "AC-GATE5C-SKIP-01: gate 5c's verdict reaches the audit record" {
  # The gate body must fold GATE_5C_STATUS into the detail that record_gate_audit
  # actually writes. Asserting the variable is SET is not enough -- it has been
  # set all along; that is precisely the defect.
  grep -q 'GATE_5C_STATUS' "$ENTRY" || {
    echo "gate-5-entry.sh does not mention GATE_5C_STATUS at all"
    return 1
  }

  # It must appear in an assignment to GATE_5_DETAIL (the audited field), not
  # merely in a comment explaining that 5c sets it.
  local wiring
  wiring=$(grep -vE '^[[:space:]]*#' "$ENTRY" | grep -E 'GATE_5_DETAIL' | grep -c 'GATE_5C_STATUS')
  [ "$wiring" -gt 0 ] || {
    echo "GATE_5C_STATUS is computed and never read: the distance between"
    echo "'alignment ran and was clean' and 'alignment never ran' is invisible"
    echo "in the journal. Found no GATE_5_DETAIL assignment using it."
    return 1
  }
}

@test "AC-GATE5C-SKIP-02: each skip reason is distinguishable, not a generic 'skipped'" {
  # A single "skipped" for all three causes would satisfy AC-01 while still
  # losing the information that matters: a missing jq is an environment fault,
  # a missing req-ids.json is a fresh clone, and no staged test files is normal.
  # Require the reasons to come from the checker rather than be invented here.
  local reasons
  reasons=$(grep -oE 'GATE_5C_REASON="[a-z_]+"' "$ALIGN" | sort -u)
  local n
  n=$(printf '%s\n' "$reasons" | grep -c . || true)
  [ "$n" -ge 3 ] || {
    echo "gate-5c sets $n distinguishable reason(s); the three skip arms"
    echo "(no req-ids.json, no jq, no staged test files) must not collapse into one:"
    printf '%s\n' "$reasons"
    return 1
  }

  # And the gate body must record that reason, not just the status.
  grep -q 'GATE_5C_REASON' "$ENTRY" || {
    echo "the checker's reason never reaches the gate body, so the journal"
    echo "cannot say WHY alignment was skipped"
    return 1
  }
}