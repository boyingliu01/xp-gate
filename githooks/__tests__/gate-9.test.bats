#!/usr/bin/env bats

# Tests for gate-9.sh (Semgrep SAST Security Scan)
# TDD: Test that gate-9.sh can be sourced standalone and sets GATE_9_STATUS

setup() {
  GATE_9_STATUS=""

  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
}

@test "gate-9.sh sources without error" {
  source "$BATS_TEST_DIRNAME/../gate-9.sh"
  [ -n "$GATE_9_STATUS" ]
}

@test "gate-9.sh sets status (WARN/SKIP/any valid)" {
  source "$BATS_TEST_DIRNAME/../gate-9.sh"
  # GATE_9_STATUS should be one of: WARN (semgrep not installed), SKIP (no files), PASS, FAIL
  [[ "$GATE_9_STATUS" =~ ^(WARN|SKIP|PASS|FAIL)$ ]]
}
