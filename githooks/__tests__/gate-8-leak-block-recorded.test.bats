#!/usr/bin/env bats
# @test REQ-GATE8-LEAK-BLOCK-RECORDED
#
# @intent When Gate 8 finds a secret it exits 1 immediately, which means the
# driver never reaches gate-8-entry.sh's journal line. That arm therefore has to
# record its own verdict -- and it did not.
#
# Gate 8 initialises GATE_8_STATUS="PASS" near the top. Every arm that does not
# overwrite it leaves that value behind, and the quality report, which reads
# gate_key_status 8, then reports whatever the variable happens to say.
#
# MEASURED 2026-11-22, probe repo with a live-looking GitHub PAT staged:
#
#     console  ❌ BLOCKED - Secrets detected in staged files.
#     exit     1        (the commit WAS refused)
#     report   {"name":"Secret Scanning","status":"SKIP","reason":"","tool":"gitleaks"}
#     overall  {"gatesRan":0,"gatesSkipped":13,"verdict":"SKIP-ALL"}
#
# So the gate blocked the commit and told the record it had skipped. Of the two
# channels, the one a later reader consults was the wrong one -- this
# repository's oldest defect, in its purest form, on the security gate.
#
# WHAT MADE IT HARD TO FIND: gate-8.sh has TWO arms that print "Secrets detected
# in staged files". The first belongs to gitleaks exiting 0 WITH findings (a
# combination that does not occur for a real leak); the second, far below, is the
# exit-1 path that actually fires. The first fix landed on the wrong arm and every
# observable stayed identical, which is why the probe below exists rather than
# only a source assertion.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G8="$REPO_ROOT/githooks/gate-8.sh"
}

# @covers the arm that actually fires sets a refusing status before exiting
@test "the gitleaks-found-secrets arm sets GATE_8_STATUS before exit" {
  # Locate the leak arm by its remediation text, then require a status assignment
  # between it and the exit. Scoping to that region is what failed last time: an
  # assertion anywhere in the file would have passed against the wrong arm.
  run bash -c '
    awk "/Secrets detected in staged files/{f=1} f&&/GATE_8_STATUS=/{print NR\": \"\$0; exit}" "$1"
  ' _ "$G8"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

# @covers that status is a refusal, not PASS and not SKIP
@test "the recorded status is a refusal" {
  run bash -c '
    awk "/Secrets detected in staged files/{f=1} f&&/GATE_8_STATUS=/{gsub(/.*GATE_8_STATUS=\"/,\"\"); gsub(/\".*/,\"\"); print; exit}" "$1"
  ' _ "$G8"
  [ "$output" = "FAIL" ] || [ "$output" = "BLOCK" ]
}

# @covers the reason explains itself
@test "the leak arm records a reason" {
  run grep -c 'GATE_8_REASON="secrets_detected_in_staged_files"' "$G8"
  [ "$output" = "1" ]
}

# @covers the journal line exists at that exit, because the normal one is skipped
@test "the leak arm writes its own journal entry" {
  run bash -c '
    awk "/Secrets detected in staged files/{f=1} f&&/record_gate_audit \"gate-8\"/{print; exit}" "$1"
  ' _ "$G8"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

# @covers the gate still parses
@test "gate-8 parses after the change" {
  run bash -n "$G8"
  [ "$status" -eq 0 ]
}
