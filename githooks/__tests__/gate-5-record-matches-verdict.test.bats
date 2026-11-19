#!/usr/bin/env bats
# @test REQ-G5-RECORD-MATCHES-VERDICT
#
# @intent Gate 5's coverage arm has a fail-closed branch: when no standard coverage
# report file exists, it prints "BLOCKED - Could not determine <lang> coverage
# percentage" and returns 1. That is the right answer.
#
# The RECORD did not get it. Measured 2026-11-20 on a PHP fixture:
#
#   console : ❌ BLOCKED - Could not determine php coverage percentage.
#   report  : gate5_tests {"status": "SKIP", "reason": ""}
#   overall : verdict PARTIAL, gatesFailed 0
#
# The console said the gate blocked. The machine-readable record -- the only thing
# `xp-gate audit`, the tech-debt trackers and the timing baseline ever see -- said the
# gate skipped for no stated reason. Neither status nor detail was assigned on the way
# out, so both kept their pre-gate values.
#
# This is the tenth instance of "verdict and record disagree" in this series. The
# previous nine were about a verdict reaching the wrong status; this one is about a
# verdict reaching no status at all.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

# @covers the fail-closed coverage branch records what it decided
@test "the could-not-determine coverage branch assigns GATE_5_STATUS" {
  # Find the branch by its message, then require a status assignment between it and
  # its `return 1`. Anchoring on the message text is deliberate: the message IS the
  # branch's identity here, and a rename should force this test to be revisited.
  local start
  start=$(grep -n 'BLOCKED - Could not determine \${CURRENT_LANG} coverage percentage' "$GATE5" | cut -d: -f1 | head -1)
  [ -n "$start" ]

  # Look at the next 14 lines: message, explanation, assignments, return.
  local window
  window=$(sed -n "${start},$((start + 14))p" "$GATE5")

  printf '%s\n' "$window" | grep -q 'GATE_5_STATUS="BLOCK"' || {
    echo "The BLOCKED coverage branch does not assign GATE_5_STATUS=BLOCK."
    echo "The report will keep whatever the status was before the gate ran."
    return 1
  }

  printf '%s\n' "$window" | grep -q 'GATE_5_DETAIL=' || {
    echo "The BLOCKED coverage branch assigns no GATE_5_DETAIL."
    echo "The persisted report will carry an empty reason."
    return 1
  }
}

# @covers the assignment is reachable, not dead code after the return
@test "the status assignment comes before the return, not after" {
  local start
  start=$(grep -n 'BLOCKED - Could not determine \${CURRENT_LANG} coverage percentage' "$GATE5" | cut -d: -f1 | head -1)
  [ -n "$start" ]

  local status_line return_line
  status_line=$(awk -v s="$start" 'NR > s && NR <= s + 14 && /GATE_5_STATUS="BLOCK"/ {print NR; exit}' "$GATE5")
  return_line=$(awk -v s="$start" 'NR > s && NR <= s + 14 && /^[[:space:]]*return 1/ {print NR; exit}' "$GATE5")

  [ -n "$status_line" ]
  [ -n "$return_line" ]
  [ "$status_line" -lt "$return_line" ]
}

# @covers the report actually reads that variable
@test "the report template reads GATE_5_STATUS and GATE_5_DETAIL" {
  local gen="$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
  run grep -c 'GATE_5_DETAIL' "$gen"
  [ "$output" -ge 1 ]
  run grep -c 'gate5_tests' "$gen"
  [ "$output" -ge 1 ]
}
