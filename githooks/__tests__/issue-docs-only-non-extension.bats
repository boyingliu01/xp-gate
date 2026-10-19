#!/usr/bin/env bats
# The docs-only fast path must not swallow code that happens to lack a known
# extension. Measured bug: a push touching githooks/pre-push plus its .bats suite
# was classified "Documentation-only push (no source code files)" and skipped the
# walkthrough entirely — the hook that ENFORCES review exempted itself from
# review by filename shape alone.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
  NON_EXT_SOURCE_RE='^(githooks/(pre-commit|pre-push|post-merge|install\.sh|verify\.sh)|[^/]+\.bats)$|/__tests__/'
  SOURCE_EXTENSIONS='\.py$|\.js$|\.cjs$|\.mjs$|\.ts$|\.tsx$|\.java$|\.go$|\.rs$|\.cpp$|\.c$|\.swift$|\.kt$|\.sh$|\.dart$|\.ps1$|\.m$|\.mm$|\.h$|\.hpp$'
}

is_code() {
  echo "$1" | grep -qE "$SOURCE_EXTENSIONS" || echo "$1" | grep -qE "$NON_EXT_SOURCE_RE"
}

@test "extensionless pre-push hook is code, not documentation" {
  run is_code "githooks/pre-push"
  [ "$status" -eq 0 ]
}

@test "extensionless pre-commit hook is code" {
  run is_code "githooks/pre-commit"
  [ "$status" -eq 0 ]
}

@test "bats test files are code" {
  run is_code "githooks/__tests__/issue-mw-main-skip.bats"
  [ "$status" -eq 0 ]
}

@test "__tests__ paths are code with or without a known extension" {
  run is_code "scripts/__tests__/fixture"
  [ "$status" -eq 0 ]
}

@test "real documentation is still documentation" {
  run bash -c "! echo README.md | grep -qE '$SOURCE_EXTENSIONS' && ! echo README.md | grep -qE '$NON_EXT_SOURCE_RE'"
  [ "$status" -eq 0 ]
}

@test "the hook itself carries the non-extension source rule" {
  run grep -n 'NON_EXT_SOURCE_RE=' "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "pre-push parses after the classification change" {
  run bash -n "$PRE_PUSH"
  [ "$status" -eq 0 ]
}
