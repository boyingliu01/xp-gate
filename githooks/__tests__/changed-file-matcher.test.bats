#!/usr/bin/env bats

setup() {
  TEST_DIR=$(mktemp -d)

  cd "$TEST_DIR"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"

  # #798: pre-commit is now an entry point that sources gate-driver.sh and
  # gate-entries/*.sh, so running the repo's pre-commit from inside a temp
  # project needs the whole set installed next to it. Install into the fixture's
  # own hook directory and run THAT copy -- which is also closer to what a user
  # actually executes.
  # shellcheck source=/dev/null
  . "$BATS_TEST_DIRNAME/helpers/install-hook-set.bash"
  install_hook_set "$BATS_TEST_DIRNAME/.." "$TEST_DIR/.git/hooks"
  HOOK_PATH="$TEST_DIR/.git/hooks/pre-commit"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
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
  # #798 reworded Gate 1's doc-only branch: it used to say "No code files
  # changed, skipping lint" and report PASSED, which read as "linted and clean"
  # for a commit where lint never ran. "Not applicable" and "passed" must not
  # read the same, so the branch now says SKIPPED and names its scope.
  [[ "$output" =~ "SKIPPED - Code quality: no changed code files in this run" ]]
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
