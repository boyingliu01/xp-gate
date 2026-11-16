#!/usr/bin/env bats
# @test REQ-806-GATE11
# @intent Gate 11 (Sprint Flow) had a `*)` fallback that printed
#         "✅ PASSED - ... (no recognisable decision in the gate output)" and left
#         GATE_11_STATUS at PASS for ANY output it could not parse. That is the
#         same defect #584 fixed for the `allow` arm, left standing one arm
#         below it: #584 established that only `allow_reason=checks-passed`
#         certifies a sprint, and `sprint-gate-report.sh` says so in as many
#         words ("Defaulting the other way would reinstate the defect"), but the
#         fallback re-armed it for every shape the parser does not recognise.
#
#         The worse shape is a CONTRADICTORY gate: `sprint-gate.sh` prints
#         {"decision":"deny",...} and exits 0. Gate 11 believed the exit code and
#         journaled PASS -- a gate that said "deny" in plain text was recorded as
#         having passed. Per sprint-gate.sh's own contract (line 49:
#         "EXIT: 0 = pass/skip, 1 = block") that combination is a protocol
#         violation, and a violation must fail CLOSED.
# @covers AC-806-G11a AC-806-G11b
#
# MEASURED WHEN WRITTEN
#   output {"something":"else"}                    exit 0 -> PASS  (wrong)
#   output {"decision":"deny","reason":"..."}      exit 0 -> PASS  (wrong)
#   output {"decision":"allow","allow_reason":
#           "phase-not-reached",...}               exit 0 -> SKIP  (correct, #584)
#   output {"decision":"allow","allow_reason":
#           "checks-passed",...}                   exit 0 -> PASS  (correct)
#   output anything                                exit 1 -> BLOCK (correct)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_11_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-11-entry.sh"
  SPRINT_REPORT_LIB="$REPO_ROOT/githooks/lib/sprint-gate-report.sh"
  FIXTURE="$(mktemp -d)"
  mkdir -p "$FIXTURE/githooks"
}

teardown() {
  rm -rf "$FIXTURE"
}

# Install a fake sprint-gate.sh that emits $1 and exits $2, then drive
# gate_11_run against it. Leaves GATE11_LOG / GATE11_STATUS_OBSERVED /
# GATE11_AUDIT for the caller.
run_gate_11() {
  local json="$1" code="$2"
  printf '#!/bin/bash\ncat <<%s\n%s\n%s\nexit %s\n' "JSON" "$json" "JSON" "$code" \
    > "$FIXTURE/githooks/sprint-gate.sh"
  chmod +x "$FIXTURE/githooks/sprint-gate.sh"

  cat > "$FIXTURE/harness.sh" <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
now_ms() { echo 5; }
record_gate_audit() { printf '%s|issues=%s' "$3" "$4" > "$AUDIT_OUT"; }
gate_enabled() { return 0; }
GATE_DIR="$FIXTURE_DIR/githooks"
SCRIPT_DIR="$FIXTURE_DIR/githooks"
source "$SPRINT_REPORT_LIB"
source "$GATE_11_ENTRY"
cd "$FIXTURE_DIR" || exit 1
gate_11_run > "$GATE11_OUT" 2>&1
printf '%s' "$GATE_11_STATUS" > "$STATUS_OUT"
HARNESS
  AUDIT_OUT="$FIXTURE/audit.txt" GATE11_OUT="$FIXTURE/gate11.log" \
    STATUS_OUT="$FIXTURE/status.txt" FIXTURE_DIR="$FIXTURE" \
    SPRINT_REPORT_LIB="$SPRINT_REPORT_LIB" GATE_11_ENTRY="$GATE_11_ENTRY" \
    bash "$FIXTURE/harness.sh" >/dev/null 2>&1 || true
  GATE11_LOG="$(cat "$FIXTURE/gate11.log" 2>/dev/null)"
  GATE11_STATUS_OBSERVED="$(cat "$FIXTURE/status.txt" 2>/dev/null)"
  GATE11_AUDIT="$(cat "$FIXTURE/audit.txt" 2>/dev/null)"
}

# ---------------------------------------------------------------------------
# AC-806-G11a: an unparsable decision must not be journaled as PASS
# ---------------------------------------------------------------------------

@test "AC-806-G11a: output with no recognisable decision records SKIP, not PASS" {
  run_gate_11 '{"something":"else"}' 0

  [[ "$GATE11_LOG" == *"no recognisable decision"* ]]
  [ "$GATE11_STATUS_OBSERVED" = "SKIP" ]
  [[ "$GATE11_AUDIT" == SKIP* ]]
}

@test "AC-806-G11a: empty output with exit 0 records SKIP, not PASS" {
  # The extreme case: a sprint-gate.sh that printed nothing. Believing exit 0
  # here means a gate that produced no verdict at all certifies the commit.
  printf '#!/bin/bash\nexit 0\n' > "$FIXTURE/githooks/sprint-gate.sh"
  chmod +x "$FIXTURE/githooks/sprint-gate.sh"

  cat > "$FIXTURE/harness.sh" <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
now_ms() { echo 5; }
record_gate_audit() { printf '%s|issues=%s' "$3" "$4" > "$AUDIT_OUT"; }
gate_enabled() { return 0; }
GATE_DIR="$FIXTURE_DIR/githooks"
SCRIPT_DIR="$FIXTURE_DIR/githooks"
source "$SPRINT_REPORT_LIB"
source "$GATE_11_ENTRY"
cd "$FIXTURE_DIR" || exit 1
gate_11_run > "$GATE11_OUT" 2>&1
printf '%s' "$GATE_11_STATUS" > "$STATUS_OUT"
HARNESS
  AUDIT_OUT="$FIXTURE/audit.txt" GATE11_OUT="$FIXTURE/gate11.log" \
    STATUS_OUT="$FIXTURE/status.txt" FIXTURE_DIR="$FIXTURE" \
    SPRINT_REPORT_LIB="$SPRINT_REPORT_LIB" GATE_11_ENTRY="$GATE_11_ENTRY" \
    bash "$FIXTURE/harness.sh" >/dev/null 2>&1 || true
  GATE11_STATUS_OBSERVED="$(cat "$FIXTURE/status.txt" 2>/dev/null)"

  [ "$GATE11_STATUS_OBSERVED" = "SKIP" ]
}

# ---------------------------------------------------------------------------
# AC-806-G11b: a contradictory gate must fail CLOSED
# ---------------------------------------------------------------------------

@test "AC-806-G11b: decision=deny with exit 0 BLOCKS the commit" {
  # sprint-gate.sh's contract: exit 0 = pass/skip, 1 = block. A deny that exits 0
  # violates it, and the safe reading of a violated contract is "not allowed".
  run_gate_11 '{"decision":"deny","reason":"delphi-review not APPROVED"}' 0

  [ "$GATE11_STATUS_OBSERVED" = "BLOCK" ]
  [[ "$GATE11_LOG" == *"BLOCK"* ]]
}

@test "AC-806-G11b: decision=skip with exit 0 still records SKIP (not BLOCK)" {
  # Anti-vacuity for the test above: "treat every contradiction as a block" would
  # satisfy it while breaking the legitimate skip path.
  run_gate_11 '{"decision":"skip","reason":"not a sprint project"}' 0

  [ "$GATE11_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-G11b anti-vacuity: allow with checks-passed still PASSES" {
  # The one shape that licenses PASS (#584). If a fix for G11a/G11b over-reached,
  # a legitimately validated sprint would stop certifying the gate.
  run_gate_11 '{"decision":"allow","allow_reason":"checks-passed","message":"delphi-review APPROVED"}' 0

  [ "$GATE11_STATUS_OBSERVED" = "PASS" ]
  [[ "$GATE11_LOG" == *"PASSED"* ]]
}

@test "AC-806-G11b anti-vacuity: allow with phase-not-reached still SKIPs (#584)" {
  # #584's contract, pinned so the fallback change cannot loosen it.
  run_gate_11 '{"decision":"allow","allow_reason":"phase-not-reached","reason":"sprint phase 1 (pre-PLAN)"}' 0

  [ "$GATE11_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-G11b anti-vacuity: exit 1 still BLOCKS" {
  # The exit-status authority must survive; a change that only reads the JSON
  # would let a crashing gate through.
  run_gate_11 '{"decision":"allow","allow_reason":"checks-passed"}' 1

  [ "$GATE11_STATUS_OBSERVED" = "BLOCK" ]
}