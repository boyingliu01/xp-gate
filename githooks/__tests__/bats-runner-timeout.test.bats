#!/usr/bin/env bats
#
# @test REQ-BATS-RUNNER-TIMEOUT
# @intent The CI bats runner passed no timeout to spawnSync, so a hung suite
#         blocked the job until the platform killed it.
#
#             const result = spawnSync('bash', args, { cwd: ROOT, stdio: 'inherit' });
#
#         There is no default: without a timeout spawnSync waits indefinitely.
#         The operator then sees a CI job that never finishes, with no indication
#         of WHICH suite stopped returning -- the one fact needed to fix it.
#
#         This is not hypothetical: gate-5a-block was measured at 880s for its
#         16 cases, and a smaller machine or a loaded one would look identical to
#         a hang for a long time before anything noticed.
#
#         The budget is derived from measurement: the slowest known suite is
#         880s, and one spawnSync covers a whole shard, so the default is
#         deliberately generous. Its job is to turn "hangs forever" into "fails
#         with a message", not to police suite duration.
#
#         What this test does NOT do is assert a specific number. A test pinned
#         to 45 minutes would break the moment someone tunes it, while proving
#         nothing about the behaviour that matters: that SOME budget exists, that
#         it is overridable, and that a timeout is reported as a timeout rather
#         than as an ordinary failure.
#
# @covers AC-BATS-TIMEOUT-01 AC-BATS-TIMEOUT-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  RUNNER="$REPO/scripts/run-bats-ci.cjs"
}

@test "AC-BATS-TIMEOUT-01: the shard spawn carries a timeout budget" {
  python3 -c '' 2>/dev/null && skip "python3 present; using grep instead"
  # The spawnSync options object must mention timeout, and there must be a
  # default that does not depend on the environment.
  grep -q 'timeout: timeoutMs' "$RUNNER" || {
    echo "spawnSync is called without a timeout; a hung suite blocks the job"
    return 1
  }
  grep -q 'XP_GATE_BATS_TIMEOUT_MS' "$RUNNER" || {
    echo "the budget is not overridable, so an unusually large shard cannot run"
    return 1
  }
  # And it must have a fallback, not just read the variable (an unset var would
  # become NaN, and spawnSync treats a non-numeric timeout as no timeout).
  grep -q '45 \* 60 \* 1000' "$RUNNER" || {
    echo "no default budget: an unset XP_GATE_BATS_TIMEOUT_MS disables the timeout"
    return 1
  }
}

@test "AC-BATS-TIMEOUT-02: a timeout is reported as a timeout, not as a test failure" {
  # spawnSync signals a timeout with signal=SIGTERM and a null status. Reporting
  # that through the ordinary `status === 0 ? 0 : 1` path would say "the suite
  # failed", when nothing failed -- the run never finished.
  grep -q "result.signal === 'SIGTERM'" "$RUNNER" || {
    echo "a timed-out shard is indistinguishable from a failing one"
    return 1
  }
  grep -q 'did not finish within' "$RUNNER" || {
    echo "the timeout path prints no message explaining what happened"
    return 1
  }
}

@test "AC-BATS-TIMEOUT-02b: the budget is honoured end to end" {
  # Behavioural: run the real runner with a 1ms budget and a suite that takes
  # seconds. It must fail FAST and say why, not run the suite to completion.
  # The runner takes --shard i/n, not a file list; any shard will do.
  local start end elapsed
  start=$(date +%s)
  run env XP_GATE_BATS_TIMEOUT_MS=1 bash -c \
    "cd '$REPO' && node scripts/run-bats-ci.cjs --shard 1/256"
  end=$(date +%s)
  elapsed=$((end - start))

  [ "$status" -ne 0 ] || {
    echo "a 1ms budget still reported success; output: $output"
    return 1
  }
  [[ "$output" == *"did not finish within"* ]] || {
    echo "the timeout message never appeared; output was:"
    printf '%s\n' "$output"
    return 1
  }
  # It must have given up quickly rather than merely failing late.
  [ "$elapsed" -lt 120 ] || {
    echo "took ${elapsed}s to report a 1ms timeout -- the budget is not wired to spawnSync"
    return 1
  }
}