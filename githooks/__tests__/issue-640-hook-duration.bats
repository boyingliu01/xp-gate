#!/usr/bin/env bats
# @test REQ-640
# @intent #640 measured that a commit spends roughly 11s OUTSIDE any gate, and had
#         no instrument to say where. The gate journal records a verdict per gate
#         but no timing at all, so the question "is this commit slow because of a
#         gate, or because of the glue between gates?" could not be answered from
#         the artifacts. Every attempt to optimise before that was guesswork.
#
#         The fix is deliberately one timestamp, not thirteen: a start marker at
#         hook entry, one subtraction when the per-run report is written. That is
#         enough to separate "the gates are slow" from "the hook around them is",
#         and it cannot perturb what it measures.
#
#         The property asserted here is that the report carries a duration when one
#         is measurable, and OMITS the field rather than writing a believable zero
#         when it is not. A `duration_ms: 0` would read as "this commit was
#         instant", which is the same class of lie as the gates that reported PASS
#         without running (#554/#562).
#
#         Not asserted: the exact value. Timing a real hook in a test would be both
#         flaky and circular -- what matters is that the field is written from a
#         real measurement and is absent otherwise.
# @covers AC-640-01, AC-640-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
}

@test "AC-640-01: pre-commit records a hook-entry start timestamp" {
  grep -q '_XP_HOOK_START_MS' "$HOOK"
  grep -q 'export _XP_HOOK_START_MS' "$HOOK"
}

@test "AC-640-01: start timestamp prefers milliseconds and falls back numerically" {
  # Milliseconds prefer /proc/uptime; the fallback must still be numeric, because a
  # non-numeric start silently disables the whole measurement.
  grep -q '/proc/uptime' "$HOOK"
  grep -q 'date +%s' "$HOOK"
  # A guard must reject a non-numeric value rather than letting it through.
  grep -qF '[!0-9]' "$HOOK"
}

@test "AC-640-02: the per-run report carries duration_ms" {
  grep -q 'duration_ms' "$HOOK"
  # It must be computed from the start we recorded, not from a constant.
  grep -q '_XP_HOOK_START_MS' "$HOOK"
}

@test "AC-640-02: duration_ms is absent, not zero, when unmeasurable" {
  # The guard must only assign when both endpoints are known and the clock moved
  # forward. Asserting the comparison itself keeps a future refactor from
  # replacing it with `|| 0`, which would turn "cannot measure" into a confident
  # zero -- the exact answer this issue was filed about.
  #
  # (This assertion used to grep for `up>st`, a fragment that no longer exists in
  # the hook. It was matching nothing and passing only because grep -c returns 0
  # on no match, which the `-ge 1` then caught -- so the test was red, not green,
  # and had been reported as a hook regression rather than a stale assertion.)
  grep -q '\$_XP_NOW_MS.*-gt.*\$_XP_HOOK_START_MS' "$HOOK"
}

@test "AC-640-01: the CRLF self-check is still the first executable line" {
  # The CRLF self-check must stay first: it is what detects a hook that cannot parse.
  # Adding the #640 timestamp BELOW it is what keeps both guarantees alive.
  run sed -n '2p' "$HOOK"
  [[ "$output" == *"_LE_CR="* ]]
}
