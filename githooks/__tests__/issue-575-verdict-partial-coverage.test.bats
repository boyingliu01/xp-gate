#!/usr/bin/env bats
# @test REQ-599
# @intent A verdict is a claim about the commit. When nine of twelve gates never
#         ran, the report still said `verdict: PASS` — and a reader takes PASS to
#         mean "this commit is fine", not "the third of the pipeline that ran is
#         fine". `SKIP-ALL` already existed for the extreme case (every gate
#         skipped); the hole was PARTIAL coverage, which is the common case for a
#         docs-only commit (#575).
#
#         These cases pin the missing rung: a run where some gates passed and
#         others never ran must NOT be reported as PASS, must NOT be reported as
#         FAIL (nothing failed), and must be distinguishable from SKIP-ALL.
#         The pass-through path — every gate ran and passed — must still be PASS,
#         so the fix cannot make the verdict uniformly unhelpful.
# @covers AC-599-07
bats_require_minimum_version 1.5.0

setup() {
  PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Extract the verdict computation (status tally + VERDICT decision) from the hook.
#
# Anchored on the `local VERDICT=` declaration and the closing `fi` of its
# if/elif chain. Self-checked by the first case before anything relies on it.
verdict_block() {
  sed -n '/^  local VERDICT="PASS"$/,/^  fi$/p' "$PRE_COMMIT"
}

# Print the verdict the hook's decision code produces for a set of gate statuses.
#   $@  STATUS values for gates 1..12, in order
#
# Nothing here re-implements the decision: the block is copied verbatim and
# executed, so a change to the hook is what the assertions see.
verdict_for() {
  local block
  block=$(verdict_block)
  [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; return 91; }
  printf '%s\n' "$block" > "$TEST_DIR/verdict.sh"
  bash -n "$TEST_DIR/verdict.sh" 2> "$TEST_DIR/blk.err" \
    || { echo "EXTRACTION-UNPARSEABLE: $(cat "$TEST_DIR/blk.err")"; return 92; }
  grep -q 'VERDICT' "$TEST_DIR/verdict.sh" \
    || { echo "EXTRACTION-MISSING-DECISION"; return 93; }

  # `local` is only legal inside a function, and the extracted text opens with
  # `local VERDICT="PASS"` — so wrap it in one.
  #
  # The statuses are passed as argv AFTER the script path, so `"$@"` inside the
  # script is the list. (An earlier draft put `"$1"` first for the helper path and
  # then relied on `"$@"` — which by then was already shifted, producing an empty
  # tally and a bogus FAIL.)
  bash -c '
    set -u
    HELPER="$1"; shift
    PASSED_COUNT=0; SKIP_COUNT=0; WARN_COUNT=0; NONPASS_COUNT=0; DEGRADED_COUNT=0
    TOTAL_GATES=12
    for st in "$@"; do
      case "$st" in
        PASS) PASSED_COUNT=$((PASSED_COUNT + 1)) ;;
        SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
        WARN) WARN_COUNT=$((WARN_COUNT + 1)); NONPASS_COUNT=$((NONPASS_COUNT + 1)) ;;
        *)    NONPASS_COUNT=$((NONPASS_COUNT + 1)) ;;
      esac
    done
    EFFECTIVE_TOTAL=$((TOTAL_GATES - SKIP_COUNT))
    compute() {
      source "$HELPER"
      printf "%s" "$VERDICT"
    }
    compute
  ' _ "$TEST_DIR/verdict.sh" "$@"
}

@test "AC-599-07: the verdict extraction parses and contains the decision (anti-vacuity)" {
  block=$(verdict_block)

  [ -n "$block" ]
  printf '%s\n' "$block" > "$TEST_DIR/verdict.sh"
  bash -n "$TEST_DIR/verdict.sh"
  grep -q 'SKIP-ALL' "$TEST_DIR/verdict.sh"
}

@test "AC-599-07: every gate ran and passed is still PASS" {
  # A WARN would legitimately forbid PASS (it means "could not run"), so the
  # clean run is all twelve PASS. This is the case the fix must not break.
  verdict=$(verdict_for PASS PASS PASS PASS PASS PASS PASS PASS PASS PASS PASS PASS)

  [ "$verdict" = "PASS" ] || { echo "got: $verdict"; return 1; }
}

@test "AC-599-07: nine gates skipped is NOT reported as PASS" {
  # The docs-only shape from the issue: 3 ran, 9 never did.
  verdict=$(verdict_for PASS PASS PASS SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP)

  [ "$verdict" != "PASS" ] || {
    echo "a run where 9 of 12 gates never executed was reported as PASS"
    return 1
  }
}

@test "AC-599-07: partial coverage is not reported as FAIL either (nothing failed)" {
  verdict=$(verdict_for PASS PASS PASS SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP)

  [ "$verdict" != "FAIL" ] || { echo "got: $verdict"; return 1; }
}

@test "AC-599-07: partial coverage is distinguishable from SKIP-ALL" {
  # SKIP-ALL means "nothing ran at all"; a partial run did run something, so the
  # two must not collapse into one value.
  verdict=$(verdict_for PASS PASS PASS SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP)

  [ "$verdict" != "SKIP-ALL" ] || { echo "got: $verdict"; return 1; }
}

@test "AC-599-07: no gate ran at all is still SKIP-ALL" {
  verdict=$(verdict_for SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP)

  [ "$verdict" = "SKIP-ALL" ] || { echo "got: $verdict"; return 1; }
}

@test "AC-599-07: a real failure is still FAIL, even when other gates skipped" {
  verdict=$(verdict_for PASS PASS FAIL SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP SKIP)

  [ "$verdict" = "FAIL" ] || { echo "got: $verdict"; return 1; }
}

@test "AC-599-07: a degraded WARN outranks PASS and must not become FAIL" {
  # A WARN means the gate could not run, not that it failed — the existing
  # contract keeps WARN out of FAIL. Verified here so a new verdict rung cannot
  # silently reclassify degradation as failure.
  verdict=$(verdict_for PASS WARN PASS PASS PASS PASS PASS PASS PASS PASS PASS PASS)

  [ "$verdict" = "WARN" ] || { echo "got: $verdict"; return 1; }
}
