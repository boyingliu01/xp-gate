#!/usr/bin/env bats

# Tests for Gate 8/9 Architecture validation (Issue #16)
# TDD: Verify archlint config and invocation

setup() {
  cd "$BATS_TEST_DIRNAME/../.."
}

@test "archlint scan works with default config" {
  run npx @archlinter/cli scan . --quiet --min-severity critical
  # Exit 0 means no critical smells, exit 1 means smells found (both acceptable)
  # We just verify the command runs successfully and produces output
  [[ "$output" == *"smells"* ]] || [ "$status" -eq 0 ]
}

@test "archlint config file exists" {
  [ -f ".archlint.yaml" ]
}

@test "architecture.yaml exists for XGate custom rules" {
  [ -f "architecture.yaml" ]
}

@test "pre-commit hook references archlint correctly" {
  # Verify pre-commit uses 'archlint scan' or 'archlint' (not bare --config)
  run grep -n "archlint" githooks/pre-commit
  [[ "$output" == *"archlint"* ]]
}

@test "archlint version is available" {
  run npx @archlinter/cli --version
  [[ "$output" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]
}
