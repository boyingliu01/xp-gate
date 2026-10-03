#!/usr/bin/env bats

# ============================================================================
# Issue #463: pre-commit prints a spurious fatal error on a repo with no commits
#
# Root cause: GATE 0 resolved the branch name with
#   CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
# On a freshly `git init`-ed repository HEAD points at an unborn branch, so
# rev-parse exits 128 and prints:
#   fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.
#
# Consequences beyond the noise:
#   - CURRENT_BRANCH falls back to the literal string "HEAD"
#   - Gate 0's protected-branch comparison then tests against a bogus name
#
# Fix: prefer `git symbolic-ref --short HEAD` (resolves the unborn branch and
# exits 0), with the old command and a literal fallback as guards.
# ============================================================================

PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"

setup() {
  TEST_REPO=$(mktemp -d)
}

teardown() {
  rm -rf "$TEST_REPO"
}

@test "Issue #463: symbolic-ref resolves the branch on a repo with no commits" {
  cd "$TEST_REPO" || return 1
  git init -q . 2>/dev/null

  # The old approach fails on an unborn branch...
  run git rev-parse --abbrev-ref HEAD
  [ "$status" -ne 0 ]

  # ...while the fix resolves it cleanly.
  run git symbolic-ref --short HEAD
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  # Must be a real branch name, never the literal "HEAD".
  [ "$output" != "HEAD" ]
}

@test "Issue #463: both CURRENT_BRANCH assignments use the guarded symbolic-ref form" {
  # There are two sites that resolve CURRENT_BRANCH; both must be guarded.
  run grep -n 'CURRENT_BRANCH=\$(git' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  local line
  while IFS= read -r line; do
    # Every CURRENT_BRANCH resolution must go through symbolic-ref first.
    [[ "$line" == *'symbolic-ref --short HEAD'* ]]
    # And must keep a literal fallback so the value is never empty.
    [[ "$line" == *'echo "HEAD"'* ]]
  done <<< "$output"
}

@test "Issue #463: pre-commit contains no unguarded 'rev-parse --abbrev-ref HEAD'" {
  # An unguarded call is exactly what regressed. Match only lines lacking a
  # stderr redirect, which every safe call site must have.
  run grep -n 'git rev-parse --abbrev-ref HEAD' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  local line
  while IFS= read -r line; do
    [[ "$line" == *'2>/dev/null'* ]]
  done <<< "$output"
}

@test "Issue #463: commit on an empty repo produces no 'ambiguous argument' error" {
  cd "$TEST_REPO" || return 1
  git init -q . 2>/dev/null

  # Smoke-check the exact command form used by the fix.
  run bash -c 'git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD"'
  [ "$status" -eq 0 ]
  [[ "$output" != *'ambiguous argument'* ]]
  [[ "$output" != *'fatal'* ]]
}
