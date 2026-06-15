#!/usr/bin/env bats

# Tests for gate-3.sh (Cyclomatic Complexity check)
# TDD: Test that gate-3.sh can be sourced standalone and sets GATE_3_STATUS

setup() {
  # These are set by pre-commit before sourcing gate-*.sh
  PROJECT_LANG="typescript"
  CHANGED_FILES="src/test.ts"
  CC_WARNINGS=0
  GATE_3_STATUS=""

  # Mock gate_start_ms (defined in pre-commit preamble, not in adapter-common.sh)
  gate_start_ms() {
    echo "0"
  }

  # Mock record_gate_audit (defined in pre-commit preamble)
  record_gate_audit() {
    :
  }
}

@test "gate-3.sh sources without error and sets GATE_3_STATUS" {
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ -n "$GATE_3_STATUS" ]
}

@test "gate-3.sh handles documentation-only project" {
  PROJECT_LANG="documentation-only"
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ "$GATE_3_STATUS" = "SKIP" ]
}

@test "gate-3.sh handles PowerShell project" {
  PROJECT_LANG="powershell"
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ "$GATE_3_STATUS" = "SKIP" ]
}
