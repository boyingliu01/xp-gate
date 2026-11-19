#!/usr/bin/env bats
#
# @test REQ-GATE8-TRAP-CHAIN a blocked commit still writes its quality report
# @intent Gate 8 modules `trap gate8_cleanup EXIT`, which REPLACES the trap
#         pre-commit installed to write the quality report. Because Gate 8 runs
#         before the gates that commonly block, the report trap was gone by the
#         time a commit was actually refused.
#
#         Measured, go fixture, 2026-11-19:
#
#             chain stopped at Gate 5 (coverage 0%)
#             ls .xp-gate/reports/pre-commit | wc -l  ->  0
#
#             same fixture, XP_GATE_ONLY_GATE=8 (chain completes)
#             ls .xp-gate/reports/pre-commit | wc -l  ->  1
#
#             same fixture, with `trap gate8_cleanup EXIT` commented out, blocked
#             ls .xp-gate/reports/pre-commit | wc -l  ->  1
#
#         So the report was not failing to generate -- it was being prevented,
#         and only on the blocked path. A passing commit got a report and a
#         refused one got nothing: the single run an operator needs in order to
#         diagnose the refusal was the one not recorded.
#
#         This is the same family as Gates 9 and 6 from the previous two commits
#         (a correct verdict that the record does not carry), with the twist that
#         here the record is not merely wrong, it is absent.
#
# @covers AC-GATE8-TRAP-01  the cleanup trap preserves a previously installed one
# @covers AC-GATE8-TRAP-02  the previous trap is captured before the new one lands
# @covers AC-GATE8-TRAP-03  cleanup still removes the temp files (anti-vacuity)
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO/githooks/adapters/gate-8.sh"
}

@test "AC-GATE8-TRAP-01: Gate 8 chains the EXIT trap instead of replacing it" {
  # The behavioural test: install a sentinel trap, source the adapter, exit, and
  # require BOTH the sentinel and the cleanup to have run.
  #
  # Reading the source for the string "trap gate8_cleanup EXIT" would pass on the
  # broken version too, so this drives a real exit instead.
  local marker="$BATS_TEST_TMPDIR/marker"
  rm -f "$marker"

  run bash -c '
    set -u
    sentinel() { echo sentinel > "$1"; }
    trap "sentinel $2" EXIT
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    exit 0
  ' _ "$ADAPTER" "$marker"

  [ -f "$marker" ] || {
    echo "the previously installed EXIT trap was destroyed by Gate 8"
    echo "-> pre-commit's report trap is what gets destroyed in the real hook,"
    echo "-> so a blocked commit writes no report"
    false
  }
}

@test "AC-GATE8-TRAP-02: the previous trap is captured BEFORE the new one is installed" {
  # Ordering, not presence. `trap -p EXIT` must run before
  # `trap gate8_cleanup_and_chain EXIT`; reversed, it captures its own trap and
  # the chain recurses or silently captures nothing.
  local cap install
  cap=$(grep -n '_GATE8_PREV_EXIT_TRAP=' "$ADAPTER" | head -1 | cut -d: -f1)
  install=$(grep -n '^trap gate8_cleanup_and_chain EXIT' "$ADAPTER" | head -1 | cut -d: -f1)

  [ -n "$cap" ] && [ -n "$install" ] || {
    echo "could not locate the capture or the install line"
    false
  }
  [ "$cap" -lt "$install" ] || {
    echo "the previous trap is captured at line $cap, AFTER installing at $install"
    false
  }
}

@test "AC-GATE8-TRAP-03: chaining did not disable the cleanup" {
  # Anti-vacuity. The reason the original trap existed is that this gate writes
  # temp files; a fix that preserves the report trap by never cleaning up would
  # trade one leak for another.
  run bash -c '
    set -u
    tmpf="$2"
    echo secret > "$tmpf"
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    GATE8_TEMP=("$tmpf")
    exit 0
  ' _ "$ADAPTER" "$BATS_TEST_TMPDIR/leak.txt"

  [ ! -f "$BATS_TEST_TMPDIR/leak.txt" ] || {
    echo "Gate 8 no longer removes its temp files -- the chain broke the cleanup"
    false
  }
}

@test "AC-GATE8-TRAP-04: chaining preserves the exit status, so a blocked commit stays blocked" {
  # This is the regression that the first version of this fix introduced, and it
  # is worse than the bug it fixed: `gate8_cleanup` overwrote `$?` with the status
  # of `rm`, the chained report trap read 0, and the hook exited 0 -- so a blocked
  # commit was ALLOWED. Preserving the report must never cost the block.
  #
  # Drives a real exit through the chain and requires the final status to survive.
  run bash -c '
    set -u
    report_trap() { local s=$?; echo "REPORT_SAW=$s"; exit "$s"; }
    trap report_trap EXIT
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || true
    exit 7
  ' _ "$ADAPTER"

  printf '%s' "$output" | grep -q 'REPORT_SAW=7' || {
    echo "the chained trap did not observe the original exit status:"
    printf '%s\n' "$output"
    echo "-> with this broken, a blocked commit exits 0 and is accepted"
    false
  }
}
