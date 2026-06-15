#!/usr/bin/env bats

# Tests for gate-7.sh (IaC Security Scanning)
# TDD: Test that gate-7.sh can be sourced standalone and sets GATE_7_STATUS

setup() {
  PROJECT_LANG="typescript"
  CHANGED_FILES=""
  GATE_7_STATUS=""

  gate_start_ms() {
    echo "0"
  }

  record_gate_audit() {
    :
  }
}

@test "gate-7.sh sources without error" {
  source "$BATS_TEST_DIRNAME/../gate-7.sh"
  [ -n "$GATE_7_STATUS" ]
}

@test "gate-7.sh passes when no IaC files changed" {
  source "$BATS_TEST_DIRNAME/../gate-7.sh"
  [ "$GATE_7_STATUS" = "PASS" ]
}
