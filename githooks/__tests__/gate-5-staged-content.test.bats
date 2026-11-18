#!/usr/bin/env bats
#
# @test REQ-GATE5-STAGED-CONTENT
# @intent Gate 5's focus-marker check read the WORKING TREE, not the commit, and
#         it did so silently for every file it examined.
#
#         The line was:
#
#             _tf_content=$(git show ":$tf" 2>/dev/null) \
#               || _tf_content=$(cat "$_tf" 2>/dev/null || true)
#
#         `$tf` is not assigned anywhere in this scope -- the loop variable is
#         `_tf`. So the command was always `git show ":"`, and git answers that
#         with:
#
#             fatal: ambiguous argument ':': unknown revision or path not in the
#             working tree
#
#         Measured: exit 128 every time, so the `||` fallback ran for 100% of
#         files. The staged-blob read never once succeeded.
 #
#         That matters because a commit gate must judge the COMMIT. The working
#         tree and the index are independently controllable, so the two directions
#         both bite:
#
#           - `it.only` still present in the working copy, removed from the index
#             -> the commit ships a clean file and nothing is reported (a
#                false pass, and the marker survives in the developer's tree to
#                be re-added later);
#           - `it.only` in the index, removed from the working copy -> the gate
#             reports a marker the commit does not contain (a false block).
#
#         The global "shellcheck baseline reset" noise that surfaced this is not
#         the point; SC2154 pointed at an undefined variable, which is worth
#         following even when the baseline is the thing complaining.
#
#         This test pins the READ SOURCE, not the whole gate: running gate_5_run
#         would execute the test suite. The source of the bytes is the entire
#         question here.
#
# @covers AC-GATE5-STAGED-CONTENT-01 AC-GATE5-STAGED-CONTENT-02
#
# ASCII only.

setup() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO" || return 1
  git init -q .
  git -c user.email=t@t -c user.name=t config user.email t@t
  git -c user.email=t@t -c user.name=t config user.name t

  mkdir -p tests
  printf 'test("ok", () => {});\n' > tests/a.test.js
  git add tests/a.test.js
  # core.hooksPath points at the installed xp-gate hooks, so a commit inside a
  # throwaway fixture would run the whole gate chain against an empty repo. The
  # fixture needs a commit, not a review.
  git -c core.hooksPath= -c user.email=t@t -c user.name=t commit -qm base
}

# The exact expression under test, extracted from the gate rather than retyped:
# a retyped copy would keep passing after the gate regressed.
gate_reads_staged_blob() {
  local src
  src="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)/githooks/gate-entries/gate-5-entry.sh"
  # The line must resolve the loop variable, not a foreign one.
  grep -q '_tf_content=$(git show ":$_tf"' "$src"
}

@test "AC-GATE5-STAGED-CONTENT-01: index and worktree can disagree, so the source matters" {
  # Index holds the CLEAN version (committed in setup, unchanged since).
  # The working copy is then edited to carry the marker.
  printf 'test.only("ok", () => {});\n' > tests/a.test.js

  run bash -c 'git show ":tests/a.test.js"'
  [ "$status" -eq 0 ] || { echo "precondition: index has no tests/a.test.js blob"; return 1; }
  [[ "$output" != *"only"* ]] || {
    echo "expected the STAGED blob to be clean while the worktree has test.only"
    return 1
  }

  # And the worktree copy WOULD match, so the two sources genuinely disagree --
  # which is what makes reading the wrong one observable.
  run grep -c 'test\.only' tests/a.test.js
  [ "$output" = "1" ]
}

@test "AC-GATE5-STAGED-CONTENT-02: the gate reads the staged blob, not the worktree" {
  gate_reads_staged_blob || {
    echo "gate-5-entry.sh no longer reads the staged blob via git show \":\\$_tf\""
    echo "(the \$tf typo is back, or the read source changed without a test update)"
    return 1
  }

  # The other direction: marker only in the index, clean working copy. Reading
  # the worktree here misses a marker that IS being committed.
  printf 'test.only("ok", () => {});\n' > tests/a.test.js
  git add tests/a.test.js
  printf 'test("ok", () => {});\n' > tests/a.test.js

  run bash -c 'git show ":tests/a.test.js"'
  [ "$status" -eq 0 ]
  [[ "$output" == *"only"* ]] || {
    echo "expected the staged blob to carry the marker this test staged"
    return 1
  }
}