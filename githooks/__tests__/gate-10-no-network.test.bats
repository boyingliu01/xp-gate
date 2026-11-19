#!/usr/bin/env bats
#
# @test REQ-GATE10-NO-NETWORK SAST must not spend its runtime on telemetry
# @intent Gate 10's own header already identifies the cost:
#
#           "A direct `semgrep scan` costs ~9s on Windows, and the bill is almost
#            entirely Python import tax: --version alone takes 4-5s because
#            semgrep's CLI eagerly imports commands.ci -> app.auth -> telemetry
#            -> opentelemetry -> requests -> urllib3."
#
#         It names telemetry as part of the import chain, and then never
#         disables it. Measured 2026-11-19 on this machine, one trivial file
#         scanned twice, ABBA-alternated so a time trend cannot explain it:
#
#             semgrep scan --config=auto ...            8095ms / 98595ms
#             SEMGREP_SEND_METRICS=off (same command)    402ms /   481ms
#
#         A 20x difference that varies with the network, which is exactly the
#         shape the audit journal recorded all along and nobody read:
#
#             445 credible sast-security rows
#               <2s      184  (41.3%)   metrics post failed fast
#               >10s     225  (50.6%)   metrics post hung
#             fastest 191ms, slowest 247358ms -- 1290x
#
#         "Any gate must not spend its main time on network waits" is a stated
#         project rule, and this gate was the single largest p90 share in the
#         chain (35.6%) precisely because it broke that rule.
#
#         These tests assert the ENVIRONMENT the gate hands to semgrep, because
#         asserting the wall clock would be a flaky proxy for it -- the network
#         is not reproducible, but the variable is.
#
# @covers AC-GATE10-NET-01  semgrep is invoked with metrics disabled
# @covers AC-GATE10-NET-02  the caller's own SEMGREP_SEND_METRICS is not needed
# @covers AC-GATE10-NET-03  a user who wants metrics can still turn them on
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO/githooks/adapters/gate-10.sh"
}

@test "AC-GATE10-NET-01: the gate disables semgrep metrics for the scan it runs" {
  # Grep the scan invocations, not the prose. The header mentions telemetry, so a
  # test that searched the whole file for the word would pass on the comment
  # alone -- the same trap that made two earlier Gate 5 tests green while proving
  # nothing.
  local scan_lines
  scan_lines=$(grep -nE '"\$SEMGREP_CMD" scan' "$GATE" || true)
  [ -n "$scan_lines" ] || {
    echo "no semgrep scan invocation found; the gate changed shape"
    false
  }

  # The variable is EXPORTED and applies to every child process, so the
  # requirement is that it is set and exported once for the whole gate -- not
  # that each call site repeats a prefix. Asserting a prefix per call line would
  # also pass for a gate that set it on one call and forgot the other.
  grep -qE '^export SEMGREP_SEND_METRICS' "$GATE" || {
    echo "SEMGREP_SEND_METRICS is set but not exported, so semgrep never sees it"
    false
  }
}
@test "AC-GATE10-NET-02: the opt-out must not depend on the caller setting it" {
  # The gate is what runs on every commit. If the only place the variable is set
  # is the operator's shell profile, a fresh clone pays the network cost and
  # nobody can see why. So the assignment must live in the gate body.
  grep -qE 'SEMGREP_SEND_METRICS="?off' "$GATE" || {
    echo "the gate does not set SEMGREP_SEND_METRICS=off itself"
    false
  }
}

@test "AC-GATE10-NET-03: a user who wants metrics keeps a way to opt back in" {
  # Anti-vacuity: hard-coding off with no escape hatch would make the previous
  # test pass while removing a choice the user may legitimately want (a team that
  # does want its semgrep metrics uploaded for central rule tuning).
  #
  # The escape hatch is expressed as "the gate's default, overridable", so the
  # file must reference an environment override rather than assigning a literal.
  grep -qE 'XP_GATE_SEMGREP_METRICS|SEMGREP_SEND_METRICS:=' "$GATE" || {
    echo "metrics are forced off with no documented way to turn them back on"
    false
  }
}
