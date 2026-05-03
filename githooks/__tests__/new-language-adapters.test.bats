#!/usr/bin/env bats

# Tests for new language adapters (Issue #17)
# TDD: Verify adapter functions exist and handle missing tools gracefully

setup() {
  cd "$BATS_TEST_DIRNAME/../.."
}

@test "java.sh defines run_static_analysis function" {
  source "githooks/adapters/java.sh"
  type run_static_analysis | grep -q "function"
}

@test "kotlin.sh defines run_static_analysis function" {
  source "githooks/adapters/kotlin.sh"
  type run_static_analysis | grep -q "function"
}

@test "dart.sh defines run_static_analysis function" {
  source "githooks/adapters/dart.sh"
  type run_static_analysis | grep -q "function"
}

@test "swift.sh defines run_static_analysis function" {
  source "githooks/adapters/swift.sh"
  type run_static_analysis | grep -q "function"
}

@test "cpp.sh defines run_static_analysis function" {
  source "githooks/adapters/cpp.sh"
  type run_static_analysis | grep -q "function"
}

@test "objectivec.sh defines run_static_analysis function" {
  source "githooks/adapters/objectivec.sh"
  type run_static_analysis | grep -q "function"
}
