#!/usr/bin/env bats

# Tests for #798: every source language must be recognised as source.
#
# @test REQ-CS-EXT-COVERAGE
# @intent A gate decides whether to run from a list of file extensions. When a
#         language is missing from that list, the gate does not fail — it
#         reports PASS on every commit having analysed nothing. That is the
#         worst failure mode a gate has: indistinguishable from success.
#
#         Measured on a real C# repository (dsh-aot-runner, 27 .cs files):
#
#           pre-commit Gate 1:
#             ✅ PASSED - No code files changed, skipping lint.
#           ...on a commit whose ONLY change was src/ArgParsing.cs.
#
#           pre-push, pushing that same commit:
#             📚 Documentation-only push (no source code files).
#             ✅ No code review required. Proceeding with push...
#
#         So the project's primary language had no static analysis and no
#         pre-push gates at all, and both hooks said it was fine. `.cs` was
#         simply absent from SOURCE_EXTENSIONS and from Gate 1's matcher.
#
#         This file pins the property that matters: THE SETS MUST AGREE. It is
#         not enough to add `.cs` to one list — the same bug was found in at
#         least twelve separate extension regexes inside pre-commit, and the
#         only one that already had `.cs` was CODE_EXTENSIONS. Drift between
#         them is invisible at runtime, so it has to be caught statically here.
#
# @covers AC-CS-EXT-01, AC-CS-EXT-02, AC-CS-EXT-03

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  # #798: Gate 1's matcher lives in gate-entries/gate-1-entry.sh, not in
  # pre-commit, which is now only the preamble + driver call + epilogue. These
  # cases extract a line RANGE around an anchor, so they read the concatenated
  # chain rather than a single file -- grepping pre-commit alone would find the
  # anchor in neither place and fail for a reason unrelated to the extension
  # list this file exists to pin.
  PRE_COMMIT="$BATS_TEST_TMPDIR/gate-chain.sh"
  cat "$REPO_ROOT/githooks/pre-commit" \
      "$REPO_ROOT/githooks/gate-driver.sh" \
      "$REPO_ROOT/githooks/gate-entries/"*.sh 2>/dev/null > "$PRE_COMMIT"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
  PRE_PUSH_PKG="$REPO_ROOT/src/npm-package/hooks/pre-push"
}

# 从 pre-push 的 SOURCE_EXTENSIONS 里取出扩展名列表
_pre_push_extensions() {
  local hook="$1"
  grep -m1 '^SOURCE_EXTENSIONS=' "$hook" \
    | sed -e 's/^SOURCE_EXTENSIONS="//' -e 's/"$//' \
    | tr '|' '\n' \
    | sed -e 's/^\\\.//' -e 's/\$$//'
}

# @test AC-CS-EXT-01: pre-push recognizes .cs as source
@test "pre-push SOURCE_EXTENSIONS includes .cs" {
  run _pre_push_extensions "$PRE_PUSH"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx 'cs'
}

# @test AC-CS-EXT-02: the shipped npm mirror agrees with the canonical hook
#
# A degree of freedom that is easy to miss: xp-gate ships BYTE MIRRORS of every
# gate script. Fixing the canonical copy and forgetting the package copy ships
# the old (broken) behaviour to every user. Gate MP would catch it at push time,
# but only if the push gets that far.
@test "npm package pre-push mirror matches canonical SOURCE_EXTENSIONS" {
  run diff <(grep -m1 '^SOURCE_EXTENSIONS=' "$PRE_PUSH") \
            <(grep -m1 '^SOURCE_EXTENSIONS=' "$PRE_PUSH_PKG")
  [ "$status" -eq 0 ]
}

# @test AC-CS-EXT-03: the other C-family source languages are covered too
#
# Adding only `.cs` fixes today's report and leaves the next one to be filed.
# The same hole applies to every unlisted language, so the list is checked for
# the mainstream compiled languages a "source code" test is expected to cover.
@test "SOURCE_EXTENSIONS covers C-family and other mainstream sources" {
  run _pre_push_extensions "$PRE_PUSH"
  [ "$status" -eq 0 ]
  for ext in cs csx fs fsx vb cpp cc cxx c h hpp rs go java kt py ts js rs; do
    if ! echo "$output" | grep -qx "$ext"; then
      echo "missing extension: .$ext" >&2
      return 1
    fi
  done
}

# @test AC-CS-EXT-04: a .cs-only push is NOT classified documentation-only
#
# The end-to-end property. Driven by running the hook's own classifier logic
# rather than a full hook run: a real push costs ~20 s and needs a git remote,
# which would make this file slower than the thing it protects.
@test "a .cs-only change set is classified as source, not documentation" {
  run bash -c '
    set -eu
    hook="$1"
    SOURCE_EXTENSIONS=$(grep -m1 "^SOURCE_EXTENSIONS=" "$hook" | sed -e "s/^SOURCE_EXTENSIONS=\"//" -e "s/\"\$//")
    NON_EXT_SOURCE_RE="^(githooks/(pre-commit|pre-push|post-merge|install\\.sh|verify\\.sh)|[^/]+\\.bats)\$|/__tests__/"
    DOC_ONLY=true
    for file in src/ArgParsing.cs; do
      if echo "$file" | grep -qE "$SOURCE_EXTENSIONS" || echo "$file" | grep -qE "$NON_EXT_SOURCE_RE"; then
        DOC_ONLY=false
        break
      fi
    done
    echo "$DOC_ONLY"
  ' _ "$PRE_PUSH"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

# @test AC-CS-EXT-05: pre-commit Gate 1 recognizes .cs
#
# Gate 1's matcher is a separate list from SOURCE_EXTENSIONS and drifted
# independently. Extract it and assert .cs is present.
@test "pre-commit Gate 1 matcher includes .cs" {
  run bash -c '
    # Anchor on the matcher itself. The old version grepped for
    # "SKIP - Code quality: no changed code files" and took the 6 lines ABOVE
    # it -- but the message says "SKIPPED - ...", so that lookup matched
    # nothing on this branch either, and the assertion then passed or failed
    # against an empty string depending on which side of the test you read.
    # #798 also moved the branch into gate-entries/gate-1-entry.sh and added a
    # comment above the echo, so a fixed offset into the chain could not work.
    #
    # The Gate 1 matcher is the any_changed_files_match call that includes
    # psm1, which no other gate matcher lists.
    grep -o "any_changed_files_match \"[^\"]*\"" "$1" | grep "psm1" | head -1
  ' _ "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  echo "$output" | grep -q 'cs'
}

# @test AC-CS-EXT-06: a skipped Gate 1 does not report PASSED
#
# The second half of the bug. Even with every extension listed, the SKIP branch
# said "✅ PASSED - No code files changed". A reader scanning for green cannot
# tell that nothing ran. Gate 3 already used "⏭️  SKIPPED" for the same
# situation; Gate 1 must match it.
@test "Gate 1 skips with SKIPPED, never with PASSED" {
  # Read the branch itself: from the SKIPPED line through its status
  # assignment. Asserting on "N lines above the message" was both brittle and,
  # because the message says SKIPPED not SKIP, was locating nothing at all.
  run bash -c '
    line_no=$(grep -n "SKIPPED - Code quality: no changed code files" "$1" | cut -d: -f1)
    [ -n "$line_no" ] || { echo "Gate 1 skip branch not found" >&2; exit 1; }
    sed -n "${line_no},$((line_no + 3))p" "$1"
  ' _ "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  # The branch must say SKIPPED...
  echo "$output" | grep -q 'SKIPPED'
  # ...and must not claim a pass in any form.
  if echo "$output" | grep -qE 'PASSED|✅'; then
    echo "Gate 1 skip branch still reports success: $output" >&2
    return 1
  fi
}

# @test AC-CS-EXT-07: the documentation-only message states what did not run
#
# "✅ No code review required" was an affirmative verdict produced by the check
# that had just misclassified the files. It must say the gates did not run.
@test "documentation-only branch does not claim review passed" {
  run bash -c '
    line_no=$(grep -n "pre-push gates NOT applicable" "$1" | cut -d: -f1)
    sed -n "${line_no},$((line_no + 6))p" "$1"
  ' _ "$PRE_PUSH"
  [ "$status" -eq 0 ]
  # Only an `echo` matters. A comment that QUOTES the old wording (this repo's
  # house style documents why a message changed) is not a live claim.
  if echo "$output" | grep -qE '^\s*echo .*No code review required'; then
    echo "still claims review passed: $output" >&2
    return 1
  fi
  echo "$output" | grep -q 'SKIPPED'
}
