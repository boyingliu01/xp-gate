#!/usr/bin/env bats

# Tests for gate-10.sh (Semgrep SAST Security Scan)
# Issue #397: gate-10.sh must set GATE_10_STATUS, not GATE_9_STATUS

setup() {
  GATE_10_STATUS=""

  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
}

@test "gate-10.sh sources without error" {
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ -n "$GATE_10_STATUS" ]
}

@test "gate-10.sh sets GATE_10_STATUS, not GATE_9_STATUS" {
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  # Gate 10 must not write to GATE_9_STATUS (Build Integrity result)
  [ -z "${GATE_9_STATUS:-}" ]
  # GATE_10_STATUS should be one of: WARN (semgrep not installed), SKIP (no files), PASS, FAIL
  [[ "$GATE_10_STATUS" =~ ^(WARN|SKIP|PASS|FAIL)$ ]]
}
