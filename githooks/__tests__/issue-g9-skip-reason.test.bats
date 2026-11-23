#!/usr/bin/env bats
#
# @test REQ-G9-SKIP-REASON a gate-9 SKIP records WHY, instead of leaving the reason blank
# @intent Checked .xp-gate/audit.jsonl on 2026-11-23: gate-9 had 19 SKIP records and
#         ALL 19 carried an empty reason.
#
#         A blank reason is worse than a wrong one, because it is unreadable in
#         three different ways at once:
#
#           - "this gate decided nothing here needed building"  (the truth)
#           - "this gate is broken and never set a variable"    (a defect)
#           - "this gate is not in the chain"                   (another defect)
#
#         The audit record cannot be used to tell those apart, so the row cannot
#         answer the only question worth asking of it.
#
#         Cause: this gate's two halves are TypeScript and Java, and its reason
#         field is GATE_9_UNVERIFIED -- which only gains a value when the change
#         set contains a language NEITHER half can check. A change set with
#         neither TypeScript nor Java (this repo's own shell/docs commits) leaves
#         it empty, which is correct for the field and useless as a reason.
#
#         The rule this pins is the project's oldest one: SKIP must be recorded
#         WITH a reason, not merely be a status value.
#
# @covers AC-G9-SKIP-REASON-01 a SKIP with nothing unverified gets an explicit reason
# @covers AC-G9-SKIP-REASON-02 a PASS is not given the skip reason
# @covers AC-G9-SKIP-REASON-03 the reason travels to record_gate_audit
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE9="$REPO/githooks/gate-entries/gate-9-entry.sh"
}

# AC-G9-SKIP-REASON-01
@test "AC-G9-SKIP-REASON-01: a bare SKIP is given an explicit reason" {
  grep -q 'GATE_9_UNVERIFIED="no_change_needing_build_integrity"' "$GATE9" || {
    echo "a SKIP with nothing unverified still leaves the reason blank"
    echo "-> the audit row cannot distinguish 'nothing to build' from 'gate broken'"
    return 1
  }
  # The assignment must be guarded by the SKIP status, not applied unconditionally.
  grep -q 'GATE_9_STATUS" = "SKIP" \] && \[ -z "${GATE_9_UNVERIFIED:-}"' "$GATE9" || {
    echo "the reason is not guarded by (status == SKIP && unverified empty)"
    return 1
  }
}

# AC-G9-SKIP-REASON-02: the reverse constraint. Without it, the reason could be
# stamped on every outcome and the test above would still pass.
@test "AC-G9-SKIP-REASON-02: a PASS is never given the skip reason" {
  # Find the PASS warning branch and assert the skip reason is not written there.
  local pass_line
  pass_line=$(grep -n 'GATE_9_STATUS" = "PASS" \] && \[ -n "${GATE_9_UNVERIFIED:-}"' "$GATE9" | head -1 | cut -d: -f1)
  [ -n "$pass_line" ] || {
    echo "the PASS-with-unverified warning is gone; this test can no longer check it"
    return 1
  }
  # Everything after the SKIP assignment block must not re-stamp the reason.
  local after
  after=$(sed -n "$((pass_line + 1)),\$p" "$GATE9")
  ! printf '%s' "$after" | grep -q 'no_change_needing_build_integrity' || {
    echo "the skip reason is written after the PASS branch too -- PASS rows would lie"
    return 1
  }
}

# AC-G9-SKIP-REASON-03: a reason computed but not passed is the recurring defect.
@test "AC-G9-SKIP-REASON-03: the reason reaches record_gate_audit" {
  grep -q 'record_gate_audit "gate-9" "build-integrity" "\$GATE_9_STATUS" "0" "\$GATE_9_START" "\${GATE_9_UNVERIFIED:-}"' "$GATE9" || {
    echo "the final audit call does not pass GATE_9_UNVERIFIED as the reason"
    return 1
  }
}
