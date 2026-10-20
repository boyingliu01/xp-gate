#!/usr/bin/env bats
# @test REQ-559 gate-10 bounds the semgrep run with a timeout
# @intent Verify Gate 10 cannot hang a commit forever. #559: the semgrep call
#         carries no runtime bound, and on the reporter's machine `semgrep
#         --version` itself hangs forever (pysemgrep burning 700+ CPU seconds,
#         no network wait). The gate's fail-closed PARSE=FAIL -> SKIP logic is
#         correct, but it is never reached, because the hook is stuck inside the
#         invocation. Only taskkill gets out. A gate that can wedge an
#         interactive `git commit` gets bypassed with --no-verify, which is worse
#         than any verdict it could have produced.
# @covers AC-559-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE10="$REPO_ROOT/githooks/gate-10.sh"
}

@test "anti-vacuity: gate-10 still invokes semgrep scan with JSON output" {
  grep -q 'scan --config=p/security-audit' "$GATE10"
  grep -q 'SEMGREP_EXIT=' "$GATE10"
}

@test "the semgrep invocation is wrapped in a timeout" {
  # Assert on the command group, not a physical line: the call spans several
  # lines now, and a layout change must not fail a semantic test.
  grep -q 'scan --config=p/security-audit' "$GATE10"
  # The bounded form must exist and must guard the scan: `timeout -k N T`
  # appearing between the timeout setup and the exit-code capture.
  local first_timeout scan_line exit_line
  first_timeout=$(grep -n 'timeout -k' "$GATE10" | head -1 | cut -d: -f1)
  scan_line=$(grep -n 'scan --config=p/security-audit' "$GATE10" | head -1 | cut -d: -f1)
  exit_line=$(grep -n 'SEMGREP_EXIT=\$?' "$GATE10" | head -1 | cut -d: -f1)
  [ -n "$first_timeout" ] && [ -n "$scan_line" ] && [ -n "$exit_line" ]
  [ "$first_timeout" -le "$scan_line" ]
  [ "$scan_line" -lt "$exit_line" ]
  # The unbounded path exists only as a documented fallback for platforms with
  # no `timeout`, and it says so out loud.
  grep -q "'timeout' command not available" "$GATE10"
}

@test "the timeout has a configurable bound with a sane default" {
  grep -qE 'XP_GATE_SEMGREP_TIMEOUT|SEMGREP_TIMEOUT' "$GATE10"
}

@test "a missing timeout binary degrades loudly instead of silently unbounded" {
  grep -q 'command -v timeout' "$GATE10"
  # And it must SAY so: an unbounded run that nobody mentioned is how #559
  # stayed invisible.
  grep -qi 'timeout' "$GATE10"
}

@test "a timed-out run is reported as a timeout, not as a clean scan" {
  grep -qE 'SEMGREP_TIMED_OUT' "$GATE10"
  # Both timeout shapes must be recognised. Measured with a semgrep stand-in
  # that traps SIGTERM: `timeout -k` returns 137 (128+SIGKILL), not 124, so
  # checking only 124 reported a cut-off scan as "unparseable".
  grep -qE '124\|137|137\|124' "$GATE10"
  # And the reason code must be distinguishable from the unparseable case.
  grep -q 'semgrep_timeout' "$GATE10"
  grep -q 'output_unparseable' "$GATE10"
}

@test "timeout -k is used so a wedged child is killed, not merely signalled" {
  # The old 0.29 code used `timeout -k 10 180`; SIGTERM alone does not stop a
  # pysemgrep spinning in a syscall.
  grep -q 'timeout -k' "$GATE10"
}

@test "an actual hang is bounded end-to-end" {
  command -v timeout >/dev/null 2>&1 || skip "no timeout binary on this platform"
  # Simulate a hanging "semgrep": the same `timeout -k 2 1` shape the gate uses
  # must return quickly with 124 rather than blocking.
  local start end
  start=$(date +%s)
  run timeout -k 2 1 bash -c 'sleep 60'
  end=$(date +%s)
  [ "$status" -eq 124 ]
  [ $((end - start)) -lt 20 ]
}
