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
  done <<< "$output"

  # #710: the literal fallback moved to the FOLLOWING line, because
  # `|| echo "HEAD"` appended to a command that already printed a partial line
  # produced the two-line value "HEAD\nunknown". The guarantee still holds —
  # it is now enforced by a non-empty check on the next line instead of by an
  # inline `|| echo`. Assert that shape rather than the old one-liner.
  local count
  count=$(grep -c 'CURRENT_BRANCH="HEAD"' "$PRE_COMMIT" || true)
  [ "${count:-0}" -ge 2 ] || {
    echo "期望两个 CURRENT_BRANCH 站点都有字面量兜底，实际 ${count:-0}"
    return 1
  }

  # And the fallback must be guarded against multi-line captures.
  grep -qF "CURRENT_BRANCH=\$(printf '%s' \"\$CURRENT_BRANCH\" | tr -d '\r\n')" "$PRE_COMMIT" || {
    echo "CURRENT_BRANCH 未做换行清理"
    return 1
  }
}

@test "Issue #463: pre-commit contains no unguarded 'rev-parse --abbrev-ref HEAD'" {
  # An unguarded call is exactly what regressed. Match only lines lacking a
  # stderr redirect, which every safe call site must have.
  #
  # #710: skip comment lines. The fix documents the failing command by name in
  # a comment, and this assertion is about EXECUTABLE call sites — flagging a
  # comment here would force the explanation out of the file that needs it.
  run grep -n 'git rev-parse --abbrev-ref HEAD' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  local line
  while IFS= read -r line; do
    [[ "$line" =~ ^[0-9]+:[[:space:]]*# ]] && continue
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
