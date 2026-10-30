#!/usr/bin/env bats
# @test REQ-609
# @intent The `attempt` field was implemented in gate-audit.ts (#603) and never
#         supplied by the hook that writes the journal. Measured against 9212 real
#         entries, not one carried `attempt` -- so "first-build pass rate" and
#         "final-build pass rate" were not merely unpopulated, they were
#         UNCOMPUTABLE, and any implementation that ignored that would have
#         reported ~100% and been believed.
#
#         That is the same half-implemented shape as a coverage threshold that is
#         never applied: the capability exists, nothing calls it, and nothing says
#         so. The guard below asserts the *wiring*, because the field definition
#         was already correct and remained useless for want of a caller.
#
#         Scoping matters as much as wiring: counting attempts globally would make
#         the index grow without bound, turning unrelated later commits into
#         "re-runs" and pinning first-pass rate near zero forever. The count is
#         scoped to HEAD so attempt 2 means "retry of this change".
# @covers AC-609-04, AC-609-05

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  WRITER="$REPO_ROOT/src/npm-package/lib/gate-audit.ts"
}

@test "AC-609-04: gate-audit accepts an attempt index" {
  run grep -q "'attempt'" "$WRITER"
  [ "$status" -eq 0 ]
}

@test "AC-609-05: pre-commit actually passes --attempt to the writer" {
  # The whole defect: the flag existed, the caller never used it.
  run grep -q -- '--attempt' "$HOOK"
  [ "$status" -eq 0 ]
}

@test "AC-609-05: attempt is scoped to the HEAD commit, not global" {
  # A global counter would climb forever; the index must restart per change.
  run grep -q 'git rev-parse HEAD' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -q '_head' "$HOOK"
  [ "$status" -eq 0 ]
}

@test "AC-609-05: an unreadable journal omits the field instead of guessing" {
  # Empty attempt -> `${_XP_GATE_ATTEMPT:+...}` expands to nothing, so the record
  # carries no attempt rather than a fabricated 1. Absence is honest; a wrong 1
  # would silently inflate the first-pass denominator.
  run grep -q '_XP_GATE_ATTEMPT=""' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -qF '${_XP_GATE_ATTEMPT:+--attempt "$_XP_GATE_ATTEMPT"}' "$HOOK"
  [ "$status" -eq 0 ]
}
