#!/usr/bin/env bats

# Tests for gate-4.sh (Principles Checker - Clean Code + SOLID)
# TDD: Test that gate-4.sh can be sourced standalone and sets GATE_4_STATUS

setup() {
  # These are set by pre-commit before sourcing gate-*.sh
  PROJECT_LANG="typescript"
  CHANGED_FILES="src/test.ts"
  GATE_4_STATUS=""
  WARNING_COUNT=0

  # Mock gate_start_ms (defined in pre-commit preamble)
  gate_start_ms() {
    echo "0"
  }

  # Mock record_gate_audit (defined in pre-commit preamble)
  record_gate_audit() {
    :
  }
}

@test "gate-4.sh sources without error and sets GATE_4_STATUS" {
  source "$BATS_TEST_DIRNAME/../gate-4.sh"
  [ -n "$GATE_4_STATUS" ]
}

@test "gate-4.sh handles documentation-only project" {
  PROJECT_LANG="documentation-only"
  source "$BATS_TEST_DIRNAME/../gate-4.sh"
  [ "$GATE_4_STATUS" = "SKIP" ]
}

@test "gate-4.sh handles no matching source files" {
  CHANGED_FILES="README.md"
  source "$BATS_TEST_DIRNAME/../gate-4.sh"
  [ "$GATE_4_STATUS" = "SKIP" ]
}
