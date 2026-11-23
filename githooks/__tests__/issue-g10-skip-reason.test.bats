#!/usr/bin/env bats
#
# @test REQ-G10-SKIP-REASON every gate-10 SKIP arm passes its reason to the journal
# @intent Measured 2026-11-23: gate-10 had 146 SKIP rows in .xp-gate/audit.jsonl and
#         125 of them carried no detail at all.
#
#         The file is 70 lines and computes a reason in THREE places, and not one
#         of them reached the record:
#
#           1. not-selected arm:  set GATE_10_DETAIL="not_selected", then called
#              record_gate_audit with FIVE arguments -- the value was dropped on
#              the very next line.
#           2. gate-10.sh missing: set GATE_10_REASON="gate_script_missing" and
#              passed five arguments.
#           3. no code files:      set GATE_10_REASON="no_code_files_changed" and
#              passed five arguments.
#
#         record_gate_audit's 6th positional parameter is the detail; there is no
#         GATE_10_REASON channel at all, so arms 2 and 3 wrote a variable nothing
#         read. Three different ways to compute a reason and zero connections --
#         the "computed, never connected" family, three times in one small file.
#
#         This is worth pinning rather than fixing quietly: the pattern recurred
#         twice in this same session (gate-9 and gate-6), and a test that names it
#         is what stops the fourth.
#
# @covers AC-G10-SKIP-REASON-01 the not-selected arm forwards its detail
# @covers AC-G10-SKIP-REASON-02 the script-missing arm forwards its reason
# @covers AC-G10-SKIP-REASON-03 the no-code-files arm forwards its reason
# @covers AC-G10-SKIP-REASON-04 every record_gate_audit call for gate-10 carries a 6th argument
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE10="$REPO/githooks/gate-entries/gate-10-entry.sh"
}

# AC-G10-SKIP-REASON-01
@test "AC-G10-SKIP-REASON-01: the not-selected arm forwards GATE_10_DETAIL" {
  grep -q 'record_gate_audit "gate-10" "sast" "\$GATE_10_STATUS" "0" "\$GATE_10_START" "\$GATE_10_DETAIL"' "$GATE10" || {
    echo "the not-selected arm still drops its detail"
    return 1
  }
}

# AC-G10-SKIP-REASON-02
@test "AC-G10-SKIP-REASON-02: the script-missing arm forwards GATE_10_REASON" {
  grep -q 'record_gate_audit "gate-10" "sast" "\$GATE_10_STATUS" "0" "\$GATE_10_START" "\$GATE_10_REASON"' "$GATE10" || {
    echo "the script-missing arm still drops its reason"
    return 1
  }
}

# AC-G10-SKIP-REASON-03: the general rule for this file. Every audit call must
# carry the 6th argument, whichever variable it names.
@test "AC-G10-SKIP-REASON-03: every gate-10 audit call carries a reason argument" {
  local bad
  bad=$(grep -n 'record_gate_audit "gate-10"' "$GATE10" \
        | grep -v '"$GATE_10_START" "\$GATE_10_' || true)
  [ -z "$bad" ] || {
    echo "these gate-10 audit calls pass no reason:"
    printf '%s\n' "$bad"
    return 1
  }
}

# AC-G10-SKIP-REASON-04: the reasons are computed at all. A call that forwards a
# variable nobody sets records nothing, which looks identical to the old bug.
@test "AC-G10-SKIP-REASON-04: the three reason values are actually set" {
  grep -q 'GATE_10_DETAIL="not_selected"' "$GATE10" || {
    echo "not_selected is no longer set"; return 1; }
  grep -q 'GATE_10_REASON="gate_script_missing"' "$GATE10" || {
    echo "gate_script_missing is no longer set"; return 1; }
  grep -q 'GATE_10_REASON="no_code_files_changed"' "$GATE10" || {
    echo "no_code_files_changed is no longer set"; return 1; }
}
