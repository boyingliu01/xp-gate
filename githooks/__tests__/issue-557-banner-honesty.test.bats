#!/usr/bin/env bats
# @test REQ-557 pre-push closing banner honesty
# @intent Verify the closing banner does not claim "ALL CHECKS PASSED" while
#         gates recorded no verdict. #557: Gate MP and Gate M (Python) skip on a
#         typical push, record no reason, and the banner still says everything
#         passed. A reviewer skimming the log has no signal that mutation
#         testing did not execute, and a retro asking "how often does Gate M
#         actually run" cannot answer, because a missing tool, a timeout and
#         "no mutable files" all produced identical output.
# @covers AC-557-01

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PREPUSH="$REPO_ROOT/githooks/pre-push"

@test "anti-vacuity: the hook still runs Gate MP and Gate M (Python)" {
  grep -q 'GATE MP' "$PREPUSH"
  grep -q 'Gate M (Python)' "$PREPUSH"
}

@test "the banner does not unconditionally claim ALL CHECKS PASSED" {
  # The fingerprint: the literal heading in the closing banner. It may exist as
  # a *conditional* string, but not as an unconditional comment heading.
  run bash -c "grep -nE '^# ALL CHECKS PASSED' '$PREPUSH'"
  [ "$status" -ne 0 ]
}

@test "Gate MP records its skip reason" {
  grep -q 'GATE_MP_SKIP_REASON\|GATE_MP_STATUS' "$PREPUSH"
}

@test "Gate M (Python) records a skip reason on the no-source path" {
  # The outermost Python branch was the only path that assigned no status,
  # while Gate M (TypeScript) records a reason on every path.
  run bash -c "grep -n -A3 'No changed Python source files' '$PREPUSH'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REASON"* || "$output" == *"reason"* || "$output" == *"STATUS"* ]]
}

@test "Gate M (Python) TIMEOUT records that the score was never measured" {
  run bash -c "grep -n -A4 'TIMEOUT (120s)' '$PREPUSH'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REASON"* || "$output" == *"reason"* || "$output" == *"STATUS"* || "$output" == *"unmeasured"* ]]
}

@test "the banner distinguishes skipped gates from passed ones" {
  grep -qE 'GATES_SKIPPED|SKIPPED_GATES|ALL CHECKS PASSED \(' "$PREPUSH"
}
