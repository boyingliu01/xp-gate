#!/usr/bin/env bats
# @test REQ-GATE-JOURNAL-DETAIL-REACHES
#
# @intent A gate that computed the reason it could not check something has to
# HAND it to the journal. `record_gate_audit`'s sixth argument is that hand-off:
#
#     record_gate_audit <gate_id> <name> <status> <issues> <start_ms> [detail]
#
# It defaults to empty, so a caller that omits it is not an error -- the line is
# still written, still has a status, and looks complete. That is exactly why this
# survived: the journal entry is well-formed, it just does not say why.
#
# MEASURED 2026-11-22 on this repository's own journal, at one commit:
#
#     gate-4   SKIP   detail ""
#     gate-6   SKIP   detail ""
#     gate-10  SKIP   detail ""
#
# while each had a reason variable already assigned:
#
#     GATE_4_REASON   set on six arms (documentation_project, tool_not_installed,
#                     checker_not_found, no_matching_files_changed, ...)
#     GATE_10_REASON  set on seven arms (tool_not_installed, no_supported_files,
#                     semgrep_timeout, output_unparseable, zero_rules, ...)
#     GATE_6_DETAIL   passed by gate-6's own early-return arm and NOT by its main
#                     exit point -- so the gate was inconsistent with itself
#
# A SKIP whose reason is computed and then dropped is the family's core failure
# in miniature: the information existed, the channel existed, nothing connected
# them. See AGENTS.md: "SKIP must be recorded, not merely printed".

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G4="$REPO_ROOT/githooks/gate-4.sh"
  G10="$REPO_ROOT/githooks/gate-10.sh"
  G6="$REPO_ROOT/githooks/gate-entries/gate-6-entry.sh"
}

# @covers gate 4 hands its reason to the journal
@test "gate-4 passes GATE_4_REASON to record_gate_audit" {
  run grep -cE 'record_gate_audit "gate-4".*"\$\{GATE_4_REASON:-\}"' "$G4"
  [ "$output" = "1" ]
}

# @covers gate 10 hands its reason to the journal
@test "gate-10 passes GATE_10_REASON to record_gate_audit" {
  run grep -cE 'record_gate_audit "gate-10".*"\$\{GATE_10_REASON:-\}"' "$G10"
  [ "$output" = "1" ]
}

# @covers gate 6's MAIN exit point agrees with its own early-return arm
@test "gate-6 passes a reason from its main exit point" {
  # The early-return arm already did. A gate that records a reason on one path
  # and not another is worse than one that never does: the journal looks like it
  # carries reasons, so nobody checks whether it always does.
  run grep -cE 'record_gate_audit "gate-6".*"\$\{GATE_6_DETAIL:-\$\{GATE_6_REASON:-\}\}"' "$G6"
  [ "$output" = "1" ]
}

# @covers every record_gate_audit call site is well formed after the change
@test "the edited gates still parse" {
  run bash -n "$G4"
  [ "$status" -eq 0 ]
  run bash -n "$G10"
  [ "$status" -eq 0 ]
  run bash -n "$G6"
  [ "$status" -eq 0 ]
}

# @covers the variable exists before it is handed over
@test "the handed-over reasons are actually assigned somewhere" {
  run grep -cE '^[[:space:]]*GATE_4_REASON=' "$G4"
  [ "$output" -ge 2 ]
  run grep -cE '^[[:space:]]*GATE_10_REASON=' "$G10"
  [ "$output" -ge 2 ]
}
