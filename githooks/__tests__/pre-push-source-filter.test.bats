#!/usr/bin/env bats
# @test REQ-480
# @intent The pre-push Gate M filter excluded files *named* *.test.* but not
#         test-TREE paths: a changed tests/** helper (e2e-server.ts) reached
#         Stryker as "production source" and scored a structurally unreachable
#         0% against the 60% threshold, blocking the push (#480).
# @covers AC-480-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-480-02: every shipped pre-push copy excludes test-tree segments in the Gate M filter" {
  for f in githooks/pre-push src/npm-package/hooks/pre-push; do
    grep -q "grep -v -E '(^|/)(tests?|__tests__)/'" "$REPO_ROOT/$f" || {
      echo "$f: Gate M CHANGED_SOURCE_FILES filter does not exclude tests?/__tests__ tree segments" >&2
      return 1
    }
  done
}

@test "AC-480-02 anti-vacuity: the tree-segment regex rejects tests/ but not production paths" {
  run bash -c "printf '%s\n' 'tests/e2e/helpers/e2e-server.ts' 'src/latest/foo.ts' \
    | grep -v -E '(^|/)(tests?|__tests__)/'"
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output")" = "src/latest/foo.ts" ]
}
