#!/usr/bin/env bats
# @test REQ-DOCSSKIP-001
# @intent Commit-level docs-only detection: when EVERY staged file matches the
#         documentation pattern set, the heavy gates (tests-coverage, duplicate
#         code, build integrity, file hygiene) short-circuit to SKIP with
#         reason=docs_only_change; one single source-code file disables it.
#         (sprint-20261018-quality REQ-F2 — distinct from the PROJECT-level
#         documentation_project detection.)
# @covers AC-DOCSSKIP-001..003

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export DOCS_LIB="$REPO_ROOT/githooks/lib/docs-only.sh"
}

run_detect() { # file list on stdin -> "true"|"false"
  local files
  files=$(cat)
  printf '%s\n' "$files" | bash -c "
    set -u
    source '$DOCS_LIB'
    detect_docs_only_commit
  "
}

@test "anti-vacuity: docs-only lib exists" {
  grep -q '^detect_docs_only_commit() {' "$DOCS_LIB"
}

@test "pure markdown commit is docs-only" {
  out=$(printf 'README.md\ndocs/plans/2026-10-18-topic.md\n' | run_detect)
  [ "$out" = "true" ]
}

@test "one source file among docs disables the short-circuit" {
  out=$(printf 'README.md\nsrc/principles/config.ts\n' | run_detect)
  [ "$out" = "false" ]
}

@test "shell and powershell scripts are source, not docs" {
  out=$(printf 'scripts/deploy.sh\nops/setup.ps1\n' | run_detect)
  [ "$out" = "false" ]
}

@test "empty file list is not docs-only (fail closed)" {
  out=$(printf '' | run_detect)
  [ "$out" = "false" ]
}

@test "config json under docs paths still counts as docs" {
  out=$(printf 'docs/diagram.json\ndocs/a.yaml\n' | run_detect)
  [ "$out" = "true" ]
}

@test "source files inside docs directories disable the short-circuit" {
  out=$(printf 'docs/tool/demo.ts\n' | run_detect)
  [ "$out" = "false" ]
}

@test "pre-commit wires the short-circuit with a reason tag" {
  grep -q 'docs-only.sh' "$REPO_ROOT/githooks/pre-commit"
  grep -q 'docs_only_change' "$REPO_ROOT/githooks/pre-commit"
}
