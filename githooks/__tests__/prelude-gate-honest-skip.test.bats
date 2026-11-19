#!/usr/bin/env bats
#
# @test REQ-PRELUDE-HONEST a prelude gate with no checker must not record a PASS
# @intent Gates 12b (mirror parity) and 12c (probe discipline) both guarded their
#         work behind a file-existence test:
#
#             if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/check-xxx.sh" ]; then ... fi
#
#         and both FELL THROUGH to the shared PASS record when that test failed.
#         Reaching the PASS line proves nothing was compared and nothing was
#         scanned -- it proves only that neither arm returned non-zero.
#
#         Measured 2026-11-20 in a fixture repo with hooks installed but no
#         scripts/ directory: a staged githooks/lib/*.sh containing a bare
#         `npx --yes eslint` probe committed cleanly, no gate-12c row appeared in
#         the report OR in the journal, and the console printed nothing at all
#         for that gate.
#
#         This is the same family as the rest of this series, in its most complete
#         form: not "reported a pass it did not earn", but "reported a pass while
#         emitting no evidence whatsoever that the gate existed".
#
# @covers AC-PH-01  12c emits a SKIP-with-reason when its checker is missing
# @covers AC-PH-02  12b emits a SKIP-with-reason when its checker is missing
# @covers AC-PH-03  neither falls through to the PASS record (the defect)
# @covers AC-PH-04  the reason names the path that was missing
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  E12B="$REPO/githooks/gate-entries/gate-12b-entry.sh"
  E12C="$REPO/githooks/gate-entries/gate-12c-entry.sh"
}

@test "AC-PH-01: gate 12c skips with a reason when check-no-npx-probe.sh is absent" {
  grep -q 'GATE_12C_STATUS="SKIP"' "$E12C" || {
    echo "12c has no SKIP arm: a missing checker falls through to PASS"
    false
  }
  grep -q 'GATE_12C_DETAIL="checker_missing"' "$E12C" || {
    echo "12c records a SKIP with no reason, which is indistinguishable from not running"
    false
  }
}

@test "AC-PH-02: gate 12b skips with a reason when check-hook-mirror.sh is absent" {
  grep -q 'GATE_12B_STATUS="SKIP"' "$E12B" || {
    echo "12b has no SKIP arm: a missing checker falls through to PASS"
    false
  }
  grep -q 'GATE_12B_DETAIL="checker_missing"' "$E12B" || {
    echo "12b records a SKIP with no reason"
    false
  }
}

@test "AC-PH-03: the checker test has an else arm, so nothing falls through" {
  # The defect was not the missing PASS, it was the missing ELSE. Check the shape
  # of the conditional rather than only the lines inside it: a SKIP block bolted
  # on after the fi would satisfy AC-PH-01 and still be unreachable.
  #
  # Anchored on the guard line itself (`-f` plus `]; then`), not on any mention of
  # the checker's filename -- that filename also appears in prose comments inside
  # the guarded block.
  #
  # And NOT "the first column-2 fi after the guard": both files contain a nested
  # column-2 fi inside the guarded block (12b line 136), so that scan stopped in
  # the middle of the body and always concluded "no else". The outer fi is the one
  # that closes the guard, and it is the LAST column-2 fi in the file.
  for e in "$E12B" "$E12C"; do
    local start last_fi
    start=$(grep -n 'scripts/check-.*\]; then$' "$e" | head -1 | cut -d: -f1)
    [ -n "$start" ] || {
      echo "could not locate the checker guard in $e"
      false
    }
    last_fi=$(grep -n '^  fi$' "$e" | tail -1 | cut -d: -f1)
    awk -v s="$start" -v f="$last_fi" 'NR >= s && NR <= f && /^  else$/ { found=1 } END { if (!found) { print "no else arm guarding the skip in " FILENAME; exit 1 } }' "$e" || return 1
  done
}

@test "AC-PH-04: the skip message names the path that was missing" {
  # A reason that says "not verified" without saying WHICH file was expected
  # leaves the reader to guess whether the install is partial.
  for e in "$E12B" "$E12C"; do
    grep -q 'is missing' "$e" || {
      echo "$e does not say which checker was missing"
      false
    }
    grep -q 'PROJECT_ROOT is unset' "$e" || {
      echo "$e conflates an unset root with a missing file"
      false
    }
  done
}
