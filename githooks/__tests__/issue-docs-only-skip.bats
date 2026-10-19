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

@test "every code-blind gate consults the docs-only verdict" {
  # The short-circuit is worthless if a heavy gate forgets to read it. Gate 9
  # (build-integrity) originally did: a markdown-only commit still paid ~11s for
  # tsc against nothing new. Count the consult sites instead of anchoring on
  # prose that sits far above the condition it guards.
  consults=$(grep -c 'DOCS_ONLY_COMMIT" = true' "$REPO_ROOT/githooks/pre-commit")
  # Gate 2, Gate 5, Gate 9 = three gates that must all read it.
  [ "$consults" -ge 3 ] || { echo "only $consults gate(s) consult DOCS_ONLY_COMMIT, expected >= 3"; return 1; }
}

@test "the docs-only skip records SKIP, never PASS" {
  # A gate that did not run must not be recorded as a pass. The Gate 9 branch
  # sets both sub-statuses to SKIP explicitly for this reason.
  grep -A6 'DOCS_ONLY_COMMIT" = true ]; then' "$REPO_ROOT/githooks/pre-commit" \
    | grep -q 'GATE_9_TS_STATUS="SKIP"'
}
