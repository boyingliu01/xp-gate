#!/usr/bin/env bats
#
# @test REQ-GATE-STATUS-SEVERITY Multi-language gates carry the strongest verdict,
#       not the last one written
# @intent A gate that iterates PROJECT_LANGS collects one verdict per language.
#         Letting each iteration assign the gate status directly produces two
#         defects that both make the gate quieter without making it correct:
#
#           1. LAST WRITER WINS -- the last language with nothing to measure
#              overwrote the verdict of one that did. Measured 2026-11-24:
#              gate-5 0 PASS / 21 SKIP, gate-6 0 PASS / 14 SKIP,
#              gate-1 0 PASS / 19 WARN -- in a repo full of TypeScript tests.
#           2. DOWNGRADE -- a branch could lower "checked and clean" to
#              "not checked", which is the fail-open direction.
#
#         This file pins the comparison rules so every gate shares one, instead
#         of three gates each growing their own guard.
#
# @covers AC-GATE-STATUS-SEVERITY-01  rank order BLOCK > WARN > SKIP > PASS
# @covers AC-GATE-STATUS-SEVERITY-02  escalate never lowers an existing verdict
# @covers AC-GATE-STATUS-SEVERITY-03  an unknown status cannot silently win
# @covers AC-GATE-STATUS-SEVERITY-04  detail fragments append, never replace
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/gate-status.sh"
  [ -f "$LIB" ] || skip "gate-status.sh not found"
  # shellcheck source=/dev/null
  source "$LIB"
}

@test "AC-GATE-STATUS-SEVERITY-01: ranks order BLOCK > WARN > SKIP > PASS" {
  [ "$(xp_gate_status_rank BLOCK)" -gt "$(xp_gate_status_rank WARN)" ]
  [ "$(xp_gate_status_rank WARN)" -gt "$(xp_gate_status_rank SKIP)" ]
  [ "$(xp_gate_status_rank SKIP)" -gt "$(xp_gate_status_rank PASS)" ]
  # An unset or unknown value must never outrank a real verdict.
  [ "$(xp_gate_status_rank '')" -eq 0 ]
  [ "$(xp_gate_status_rank BOGUS)" -eq 0 ]
}

@test "AC-GATE-STATUS-SEVERITY-02: escalate raises but never lowers" {
  # A real pass followed by a language that measured nothing.
  GATE_X_STATUS="PASS"
  xp_gate_status_escalate GATE_X_STATUS "SKIP"
  [ "$GATE_X_STATUS" = "SKIP" ]

  # A real pass followed by a language reporting a problem.
  GATE_X_STATUS="PASS"
  xp_gate_status_escalate GATE_X_STATUS "WARN"
  [ "$GATE_X_STATUS" = "WARN" ]

  # Escalation is monotonic: a weaker candidate must not lower it.
  GATE_X_STATUS="BLOCK"
  xp_gate_status_escalate GATE_X_STATUS "WARN"
  xp_gate_status_escalate GATE_X_STATUS "PASS"
  [ "$GATE_X_STATUS" = "BLOCK" ]

  # Unset behaves like PASS: the first real verdict wins.
  unset GATE_X_STATUS
  xp_gate_status_escalate GATE_X_STATUS "SKIP"
  [ "$GATE_X_STATUS" = "SKIP" ]
}

@test "AC-GATE-STATUS-SEVERITY-03: an unknown candidate is refused, not ranked as weakest" {
  GATE_X_STATUS="PASS"
  run xp_gate_status_escalate GATE_X_STATUS "MAYBE"
  [ "$status" -eq 2 ]
  # The refusal must not have changed the verdict.
  [ "$GATE_X_STATUS" = "PASS" ]
}

@test "AC-GATE-STATUS-SEVERITY-04: detail appends without replacing" {
  unset GATE_X_DETAIL
  xp_gate_detail_append GATE_X_DETAIL "powershell: PSSA module not installed"
  [ "$GATE_X_DETAIL" = "powershell: PSSA module not installed" ]

  xp_gate_detail_append GATE_X_DETAIL "iac: not configured"
  [ "$GATE_X_DETAIL" = "powershell: PSSA module not installed; iac: not configured" ]

  # The same fragment twice must not repeat: a language can report more than once.
  xp_gate_detail_append GATE_X_DETAIL "iac: not configured"
  [ "$GATE_X_DETAIL" = "powershell: PSSA module not installed; iac: not configured" ]

  # An empty fragment is a no-op, not a trailing separator.
  xp_gate_detail_append GATE_X_DETAIL ""
  [ "$GATE_X_DETAIL" = "powershell: PSSA module not installed; iac: not configured" ]
}

# --- Round 1 review findings (2026-11-24) -------------------------------
#
# Expert B identified separator injection: a fragment that itself contains
# "; " is split when the concatenation is de-duplicated, so it is never equal
# to any single segment and always appended -- and a later read cannot tell the
# parts from separate reasons. Expert A flagged the same boundary set from the
# coverage side.

@test "AC-GATE-STATUS-SEVERITY-05: a fragment containing the separator is still de-duplicated" {
  unset GATE_X_DETAIL
  xp_gate_detail_append GATE_X_DETAIL "a; b"
  local once="$GATE_X_DETAIL"
  # The internal separator is flattened on the way in, so this fragment is ONE
  # segment. That is the property: without it, "a; b" splits into "a" and "b"
  # and the next append sees neither.
  case "$once" in
    *"; "*) echo "fragment still contains the join separator: $once"; return 1 ;;
  esac
  # Appending the same fragment again must not duplicate it.
  xp_gate_detail_append GATE_X_DETAIL "a; b"
  [ "$GATE_X_DETAIL" = "$once" ]
}

@test "AC-GATE-STATUS-SEVERITY-06: an empty or whitespace fragment is a no-op" {
  GATE_X_DETAIL="keep"
  xp_gate_detail_append GATE_X_DETAIL ""
  xp_gate_detail_append GATE_X_DETAIL "   "
  # Neither adds a separator nor replaces the existing value.
  [ "$GATE_X_DETAIL" = "keep" ]
}

@test "AC-GATE-STATUS-SEVERITY-07: escalation reports failure for an unknown candidate" {
  GATE_X_STATUS="PASS"
  run xp_gate_status_escalate GATE_X_STATUS "UNKNOWN_VALUE"
  [ "$status" -eq 2 ]
  [ "$GATE_X_STATUS" = "PASS" ]
}
