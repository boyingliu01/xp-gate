#!/usr/bin/env bats
#
# @test REQ-GATE5-DELETE-DETECTION
# @intent The deleted-test warning is unreachable for the commits it exists for.
#
#         Gate 5 carries two guards against the quiet ways a green build lies:
#         a `.only` marker (CI runs one case and reports green) and a deleted
#         test file (the safety net vanishes with no signal). The header calls
#         them "the two quietest ways to fix a red build".
#
#         Measured: committing ONLY the deletion of a test file reports
#
#             ⏱️  Gate 5: 2124ms (skipped - no code changes)
#             Gate 5: Tests + Coverage    SKIP (coverage: N/A%)
#
#         No warning, no mention of the deleted file. The deletion scan sits
#         inside `if [ -n "$STAGED_TEST_FILES" ]`, and STAGED_TEST_FILES is built
#         with `git diff --cached --diff-filter=ACM` -- which by construction
#         never contains a deleted file. A commit that deletes tests and adds
#         nothing is therefore the ONE case where the guard cannot run, and it
#         is exactly the case the guard was written for.
#
#         The `.only` half is fine, and was verified end to end first: a staged
#         `test.only(...)` blocks with the line number. So this is not "the whole
#         family is broken"; it is one arm gated behind a condition that excludes
#         its own trigger.
#
#         Why this matters more than a missing warning: the commit then proceeds
#         to the "no code files changed" early skip, whose recorded reason
#         (no_code_files_changed) is true but tells the operator nothing about a
#         test having been removed. The journal shows a gate that stood down for
#         a benign reason while the safety net disappeared.
#
#         The fix is to hoist the deletion scan out of the STAGED_TEST_FILES
#         guard, so it runs whenever anything is staged.
#
# @covers AC-GATE5-DELETE-01 AC-GATE5-DELETE-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO/githooks/gate-entries/gate-5-entry.sh"
}

@test "AC-GATE5-DELETE-01: the deletion scan is not gated behind the ADDED/MODIFIED list" {
  # Structural, but pinned to the failure mode: the call must not be nested
  # inside the block that requires a non-empty STAGED_TEST_FILES.
  #
  # Find the line that opens `if [ -n "$STAGED_TEST_FILES" ]`, and the line that
  # invokes classify_deleted_tests. Compare their indentation: a child of the
  # guard is indented deeper than the guard itself.
  local guard_line call_line guard_indent call_indent
  guard_line=$(grep -nE 'if \[ -n "\$STAGED_TEST_FILES" \]' "$ENTRY" | head -1 | cut -d: -f1)
  call_line=$(grep -n 'classify_deleted_tests' "$ENTRY" | grep -v '^\s*#' | head -1 | cut -d: -f1)

  [ -n "$guard_line" ] && [ -n "$call_line" ] || {
    echo "could not locate the guard ($guard_line) or the deletion scan ($call_line)"
    return 1
  }

  low_to=""
  [ "$call_line" -gt "$guard_line" ] && low_to="$call_line"
  [ -n "$low_to" ] || return 0   # scan already precedes the guard

  guard_indent=$(sed -n "${guard_line}p" "$ENTRY" | sed 's/[^ ].*//' | wc -c)
  call_indent=$(sed -n "${call_line}p" "$ENTRY" | sed 's/[^ ].*//' | wc -c)

  [ "$call_indent" -le "$guard_indent" ] || {
    echo "the deletion scan (line $call_line, indent $call_indent) is nested inside"
    echo "the STAGED_TEST_FILES guard (line $guard_line, indent $guard_indent)."
    echo "STAGED_TEST_FILES is built with --diff-filter=ACM, so a commit that only"
    echo "DELETES tests can never reach the scan -- the one case it exists for."
    return 1
  }
}

@test "AC-GATE5-DELETE-02: a deleted test file reaches the warning, end to end" {
  # BEHAVIOURAL, through the real hook in a real repo. The first version of this
  # test called classify_deleted_tests directly and was GREEN against the broken
  # gate -- it proved the classifier works, never that the gate calls it. That is
  # the "assertion that never reaches the code under test" family again.
  local work="$BATS_TEST_TMPDIR/g5del"
  mkdir -p "$work"
  git -C "$work" init -q -b g5del
  # Minimal hook install: the real pre-commit plus everything it sources.
  for f in pre-commit gate-driver.sh adapter-common.sh gate-registry.sh hook-module-resolution.sh; do
    cp "$REPO/githooks/$f" "$work/.git/hooks/$f" 2>/dev/null || true
  done
  cp -r "$REPO/githooks/gate-entries" "$work/.git/hooks/" 2>/dev/null || true
  cp -r "$REPO/githooks/lib" "$work/.git/hooks/" 2>/dev/null || true
  cp -r "$REPO/githooks/adapters" "$work/.git/hooks/" 2>/dev/null || true

  printf "export const v = 1;
" > "$work/s.ts"
  printf "import {v} from "./s";
test("v",()=>{expect(v).toBe(1)});
" > "$work/s.test.ts"
  git -C "$work" -c user.email=t@t -c user.name=t -c core.hooksPath= add -A
  git -C "$work" -c user.email=t@t -c user.name=t -c core.hooksPath= commit -q --no-verify -m init

  # Stage ONLY the deletion: no added or modified source or test file.
  rm -f "$work/s.test.ts"
  git -C "$work" rm -q --cached s.test.ts

  cd "$work"
  run bash .git/hooks/pre-commit

  [[ "$output" == *"deleted with no same-named replacement"* ]] || {
    echo "a commit that only DELETES a test produced no warning; the safety net"
    echo "vanished silently. Output tail:"
    printf "%s
" "$output" | tail -8
    return 1
  }
  [[ "$output" == *"s.test.ts"* ]] || {
    echo "the warning fired but did not name the deleted file; output tail:"
    printf "%s
" "$output" | tail -6
    return 1
  }
}
