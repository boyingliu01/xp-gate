#!/usr/bin/env bats
# @test REQ-GATE78-SKIP-REASON-RECORDED
#
# @intent A SKIP must say why, everywhere it is recorded -- not only on the
# console. This is the repository's oldest and most repeated defect family, and
# it had two more instances left in the gates that scan for security problems.
#
# MEASURED 2026-11-22 on a probe repo:
#
#   gate-7  no reason variable existed at all. Both SKIP arms ("no IaC files in
#           this change set", "no IaC adapter found") printed a sentence and the
#           journal recorded a bare SKIP. The two arms were ALSO indistinguishable
#           from each other afterwards -- one means "there was nothing to scan",
#           the other means "I could not scan what was there".
#
#   gate-8  same. Its two SKIP arms deliberately distinguish "gitleaks scanned and
#           reported no leaks but wrote no artifact" from "gitleaks produced no
#           readable report and no summary". The console told them apart and the
#           record did not.
#
#   report  the quality report had no "reason" field for gate 2, gate 7 or gate 8
#           at all, so even a variable would have gone nowhere. Gate 4's field had
#           existed all along, which is how its defect stayed invisible: the pipe
#           was there, nothing flowed through it.
#
# Both security gates are fail-closed on tool failure. That makes an unlabelled
# SKIP worse here than elsewhere: a reader who cannot tell "nothing to scan" from
# "could not scan" will treat the security gate's silence as coverage.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G7="$REPO_ROOT/githooks/gate-7.sh"
  G8="$REPO_ROOT/githooks/gate-8.sh"
  REPORT="$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
}

# @covers gate 7 declares and assigns a reason
@test "gate-7 records why it skipped" {
  run grep -c 'GATE_7_REASON=' "$G7"
  # declaration + two SKIP arms
  [ "$output" -ge 3 ]
  run grep -c 'GATE_7_REASON="no_iac_files_changed"' "$G7"
  [ "$output" = "1" ]
  run grep -c 'GATE_7_REASON="adapter_not_found"' "$G7"
  [ "$output" = "1" ]
}

# @covers gate 7's two SKIP arms stay distinguishable
@test "gate-7 does not collapse its two SKIP reasons into one" {
  local a b
  a=$(grep -c 'GATE_7_REASON="no_iac_files_changed"' "$G7")
  b=$(grep -c 'GATE_7_REASON="adapter_not_found"' "$G7")
  [ "$a" = "1" ]
  [ "$b" = "1" ]
}

# @covers gate 8 declares and assigns a reason
@test "gate-8 records why it skipped" {
  run grep -c 'GATE_8_REASON=' "$G8"
  [ "$output" -ge 3 ]
  run grep -c 'GATE_8_REASON="no_artifact_scan_reported_clean"' "$G8"
  [ "$output" = "1" ]
  run grep -c 'GATE_8_REASON="no_evidence_no_report_no_summary"' "$G8"
  [ "$output" = "1" ]
}

# @covers the report has a slot for each of them
@test "the quality report carries a reason field for gates 2, 7 and 8" {
  run grep -c '"reason": "${GATE_7_REASON:-}"' "$REPORT"
  [ "$output" = "1" ]
  run grep -c '"reason": "${GATE_8_REASON:-}"' "$REPORT"
  [ "$output" = "1" ]
  run grep -c '"reason": "${GATE_2_DETAIL:-}"' "$REPORT"
  [ "$output" = "1" ]
}

# @covers gate 2 uses the variable it actually maintains
@test "gate-2 records its reason through GATE_2_DETAIL, not a dead variable" {
  # GATE_2_REASON was assigned and never read once already; the note in the gate
  # says so. GATE_2_DETAIL is what record_gate_audit consumes, so the report must
  # read THAT -- reading a resurrected GATE_2_REASON would be the same defect
  # wearing a new name.
  # Only an ASSIGNMENT counts: the gate carries a comment explaining why
  # GATE_2_REASON was removed, and that comment must not read as a live variable.
  run grep -cE '^[[:space:]]*GATE_2_REASON=' "$REPO_ROOT/githooks/gate-entries/gate-2-entry.sh"
  [ "$output" = "0" ]
  run grep -c '"reason": "${GATE_2_DETAIL:-}"' "$REPORT"
  [ "$output" = "1" ]
}

# @covers both gates still parse
@test "gate-7 and gate-8 parse after the change" {
  run bash -n "$G7"
  [ "$status" -eq 0 ]
  run bash -n "$G8"
  [ "$status" -eq 0 ]
  run bash -n "$REPORT"
  [ "$status" -eq 0 ]
}
