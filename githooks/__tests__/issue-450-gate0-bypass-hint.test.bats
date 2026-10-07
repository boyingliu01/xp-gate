#!/usr/bin/env bats

# Gate 0 bypass hint contract (#450).
# The old hint ("include [skip-version-check] in commit message") misled users:
# the bypass actually requires the marker at the START of the first line plus a
# chore:/docs:/release: prefix, and only covers build-tooling diffs.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PRE_COMMIT_COPY="$REPO_ROOT/githooks/pre-commit"
PRE_COMMIT_MIRROR="$REPO_ROOT/src/npm-package/hooks/pre-commit"

@test "AC-450-01: bypass hint states the first-line START requirement and full format" {
  local text
  text=$(cat "$PRE_COMMIT_COPY")
  echo "$text" | grep -q "FIRST LINE must START with"
  echo "$text" | grep -qF "[skip-version-check] chore: <description>"
  echo "$text" | grep -q "chore: docs: release:"
  echo "$text" | grep -q "adapters/, scripts/, hooks/"
}

@test "AC-450-02: misleading hint is gone from both pre-commit copies (mirrors in sync)" {
  for copy in "$PRE_COMMIT_COPY" "$PRE_COMMIT_MIRROR"; do
    if grep -q "include \[skip-version-check\] in commit message" "$copy"; then
      fail "stale misleading hint still present in $copy"
    fi
    grep -q "FIRST LINE must START with" "$copy" || fail "new hint missing in $copy"
  done
}

@test "AC-450-03: anti-vacuity — the structural matcher rejects a copy without the hint" {
  local tmp_fixture
  tmp_fixture="$(mktemp)"
  printf '#!/bin/sh\nOr use --no-verify (discouraged) or include [skip-version-check] in commit message.\n' > "$tmp_fixture"
  if grep -q "FIRST LINE must START with" "$tmp_fixture"; then
    rm -f "$tmp_fixture"
    fail "matcher accepted a copy lacking the new hint"
  fi
  rm -f "$tmp_fixture"
}
