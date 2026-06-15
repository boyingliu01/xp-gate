#!/usr/bin/env bats

# Tests for gate-8.sh (Secret Scanning - gitleaks)
# TDD: Test that gate-8.sh can be sourced standalone and sets GATE_8_STATUS

setup() {
  GATE_8_STATUS=""

  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
}

@test "gate-8.sh sources without error" {
  source "$BATS_TEST_DIRNAME/../gate-8.sh"
  [ -n "$GATE_8_STATUS" ]
}

@test "gate-8.sh sets GATE_8_STATUS (PASS or SKIP)" {
  source "$BATS_TEST_DIRNAME/../gate-8.sh"
  # GATE_8_STATUS should be PASS (gitleaks installed) or SKIP (gitleaks not installed)
  [ "$GATE_8_STATUS" = "PASS" ] || [ "$GATE_8_STATUS" = "SKIP" ]
}
