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
  # #798 moved the gate bodies out of pre-commit into githooks/gate-entries/.
  # The wiring assertions below are about the SHIPPED hook, which is now a
  # preamble plus one entry file per gate; searching only pre-commit found
  # nothing and reported "the short-circuit is not wired", which is exactly the
  # regression this suite exists to catch. HOOK_SRC is the whole shipped hook.
  HOOK_SRC="$(cat "$REPO_ROOT/githooks/pre-commit"                   "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)"
  [ -n "$HOOK_SRC" ] || { echo "no shipped hook sources found"; return 1; }
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
  grep -q 'docs-only.sh' <<< "$HOOK_SRC" || { echo "the docs-only lib is never sourced"; return 1; }
  grep -q 'docs_only_change' <<< "$HOOK_SRC" || { echo "no gate tags its skip with docs_only_change"; return 1; }
}

@test "every code-blind gate consults the docs-only verdict" {
  # The short-circuit is worthless if a heavy gate forgets to read it. Gate 9
  # (build-integrity) originally did: a markdown-only commit still paid ~11s for
  # tsc against nothing new. Count the consult sites instead of anchoring on
  # prose that sits far above the condition it guards.
  consults=$(grep -c 'DOCS_ONLY_COMMIT" = true' <<< "$HOOK_SRC")
  # Gate 2, Gate 5, Gate 9 = three gates that must all read it.
  [ "$consults" -ge 3 ] || { echo "only $consults gate(s) consult DOCS_ONLY_COMMIT, expected >= 3"; return 1; }
}

@test "the docs-only skip records SKIP, never PASS" {
  # A gate that did not run must not be recorded as a pass: the branch that
  # consumes the verdict must set its sub-status to SKIP.
  #
  # Scoped to GATE 9's own body deliberately. Awk-ing the concatenated hook and
  # slicing from the first `DOCS_ONLY_COMMIT = true` reaches a DIFFERENT gate:
  # Gates 2, 5 and 9 each carry that condition, and the earlier files come first,
  # so the slice closed inside gate-2 and never saw Gate 9's assignment.
  local src="$REPO_ROOT/githooks/gate-entries/gate-9-entry.sh"
  [ -f "$src" ] || { echo "Gate 9's body is not where this test looks: $src"; return 1; }
  grep -q 'DOCS_ONLY_COMMIT' "$src" || { echo "Gate 9 no longer consults the docs-only verdict"; return 1; }
  local branch
  branch=$(awk '/DOCS_ONLY_COMMIT" = true/{f=1} f && /^elif |^fi$/{exit} f' "$src")
  [ -n "$branch" ] || { echo "could not slice Gate 9's docs-only branch"; return 1; }
  grep -q 'GATE_9_TS_STATUS="SKIP"' <<< "$branch" || {
    echo "the docs-only branch does not record Gate 9 as SKIP"
    return 1
  }
}
