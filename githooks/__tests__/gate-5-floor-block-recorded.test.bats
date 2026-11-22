#!/usr/bin/env bats
# @test REQ-GATE5-FLOOR-BLOCK-RECORDED
#
# @intent A gate printed BLOCKED and recorded SKIP. The console and the journal
# disagreed about the same commit.
#
# Measured 2026-11-22 on a Python fixture at 48% line coverage against an 80% floor:
#
#     → Gate 5: Tests & coverage...
#     FAIL Required test coverage of 80% not reached. Total coverage: 48.39%
#     ❌ BLOCKED - Python coverage 48% below 80% threshold
#       Gate 5: Tests + Coverage     SKIP (coverage: 48%)
#
# The commit WAS blocked -- Gate 5 returned 1 and the chain stopped -- so the
# enforcement worked. What did not work is the record. `return 1` propagated the
# exit without assigning GATE_5_STATUS, and the epilogue only promotes an EMPTY
# status to PASS, so the status stayed empty and rendered as SKIP.
#
# WHY THIS KEPT HAPPENING
#
# The same lesson is already written into the neighbouring "could not determine
# coverage" branch, which sets GATE_5_STATUS="BLOCK" first and explains that
# "a verdict that only reaches the console is a verdict the journal contradicts".
# The floor-miss branch is the same defect one condition over -- and the Python
# arm added a third instance by delegating to lib/coverage-total.sh, which returns
# a verdict but has no access to the gate's status variable.
#
# So the fix is at BOTH layers: the in-file generic branch records its verdict, and
# the call site records what the library returned.
#
# These cases assert on the source, because the behaviour needs a real Python
# project with a real coverage run. The end-to-end proof lives in
# scripts/gate-language-probe.sh (python_gate5), which drives a 48% project to BLOCK
# and a 100% project to PASS.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
  LIB="$REPO_ROOT/githooks/lib/coverage-total.sh"
}

# @covers every "below floor" BLOCK path records its verdict
#
# There are three such branches (typescript, java, the generic language fallthrough),
# and the grep checks each one's PRECEDING lines for the assignment. Checking
# forward was wrong: the fix has to come BEFORE the return, so a forward window
# would pass on a status assigned after the return -- which is dead code.
@test "every floor-miss branch assigns GATE_5_STATUS before returning" {
  run bash -c '
    file="$1"
    misses=0
    while IFS=: read -r ln _; do
      # Look at the two lines before the BLOCKED echo for the assignment.
      start=$((ln - 12))
      [ "$start" -lt 1 ] && start=1
      if ! sed -n "${start},$((ln - 1))p" "$file" | grep -q "GATE_5_STATUS=\"BLOCK\""; then
        echo "unrecorded BLOCK at line $ln"
        misses=$((misses + 1))
      fi
    done < <(grep -n "below \${COVERAGE_THRESHOLD:-80}% threshold" "$file")
    [ "$misses" -eq 0 ]
  ' _ "$GATE5"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# @covers the Python arm records the library verdict at the call site
@test "the python coverage call site assigns GATE_5_STATUS on failure" {
  run grep -n -A5 'if ! enforce_python_coverage' "$GATE5"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'GATE_5_STATUS="BLOCK"'
}

# @covers the reason reaches the journal, not just the status
#
# A BLOCK with no reason is a bug per AGENTS.md: SKIP must always carry why, and the
# same applies to a block -- the reader has to know which floor was missed.
@test "the floor-miss BLOCK carries a machine-readable reason" {
  run grep -n 'coverage_below_floor' "$GATE5"
  [ "$status" -eq 0 ]
}

# @covers the library is not asked to do something it cannot
#
# lib/coverage-total.sh returns a verdict to its caller; it does not know the gate's
# status variable. Asserting that here keeps the responsibility at the boundary
# instead of tempting a future edit to set a global it cannot see.
@test "the coverage library returns a verdict and leaves the status to its caller" {
  # grep exits 1 when it finds nothing, and finding nothing is exactly the expected
  # result here, so the count is collected without asserting on grep's own status.
  count=$(grep -c 'GATE_5_STATUS' "$LIB" || true)
  [ "$count" -eq 0 ]
}

# @covers the BLOCK is not silently downgraded by the epilogue
#
# The epilogue defaults an EMPTY status to PASS. That must never overwrite a status
# a branch already set -- this is the #554 regression, still guarded.
@test "the epilogue only fills an empty status" {
  run grep -n -B1 'GATE_5_STATUS="PASS"' "$GATE5"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'elif \[ -z "$GATE_5_STATUS" \]'
}
