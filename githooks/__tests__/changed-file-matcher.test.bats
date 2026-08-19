#!/usr/bin/env bats

setup() {
  TEST_DIR=$(mktemp -d)
  HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"

  cd "$TEST_DIR"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
}

teardown() {
  rm -rf "$TEST_DIR"
}

run_hook_for() {
  local file_path="$1"

  mkdir -p "$(dirname -- "$file_path")"
  printf '%s\n' "fixture" > "$file_path"
  git add -- "$file_path"
  run env SKIP_VERSION_CHECK=1 XP_GATE_LANG=documentation-only bash "$HOOK_PATH"
}

assert_matcher_available() {
  [[ ! "$output" =~ "any_changed_files_match: command not found" ]]
}

@test "doc-only staged files skip code, IaC, and SAST gates" {
  run_hook_for "docs/policy notes.md"

  assert_matcher_available
  [[ "$output" =~ "No code files changed, skipping lint" ]]
  [[ "$output" =~ "No IaC files changed, skipping Gate 7" ]]
  [[ "$output" =~ "No code files changed, skipping SAST scan" ]]
}

@test "JavaScript staged files activate code and SAST but skip IaC" {
  run_hook_for "src/-entry file.js"

  assert_matcher_available
  [[ ! "$output" =~ "No code files changed, skipping lint" ]]
  [[ "$output" =~ "No IaC files changed, skipping Gate 7" ]]
  [[ ! "$output" =~ "No code files changed, skipping SAST scan" ]]
}

@test "YAML staged files activate lint and IaC but skip SAST" {
  run_hook_for "infra/-deployment file.yaml"

  assert_matcher_available
  [[ ! "$output" =~ "No code files changed, skipping lint" ]]
  [[ ! "$output" =~ "No IaC files changed, skipping Gate 7" ]]
  [[ "$output" =~ "No code files changed, skipping SAST scan" ]]
}
