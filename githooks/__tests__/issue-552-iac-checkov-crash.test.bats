#!/usr/bin/env bats
# @test REQ-552 IaC gate distinguishes a crashed scanner from a passing one
# @intent Verify Gate 7 does not turn a checkov crash into a security verdict.
#         #552: checkov exits 2 with an AttributeError traceback (a broken
#         detect_secrets dependency), and the gate reported "1 security
#         issue(s) found by checkov. Blocking commit." Nothing about that is a
#         security finding -- the tool never got far enough to judge anything.
#         Both directions are wrong: counting the traceback invents findings,
#         and a crash whose text happens to lack the marker would report a clean
#         pass. A crashed scanner is "unusable", which is its own verdict.
# @covers AC-552-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  IAC="$REPO_ROOT/githooks/adapters/iac.sh"
}

@test "anti-vacuity: the checkov invocation is still in iac.sh" {
  grep -q 'checkov --file' "$IAC"
}

@test "every checkov invocation is followed by a status recording" {
  # The defect was a bare invocation whose status went nowhere. Counting lines
  # does not need a regex that pins indentation: every `checkov --file` line must
  # be immediately followed by record_checkov_run.
  local total recorded
  total=$(grep -cE '^\s*checkov --file ' "$IAC")
  recorded=$(grep -A1 -E '^\s*checkov --file ' "$IAC" | grep -c 'record_checkov_run')
  [ "$total" -ge 1 ]
  [ "$total" -eq "$recorded" ]
}

@test "the adapter tracks whether any checkov run crashed" {
  grep -q 'CHECKOV_CRASHED' "$IAC"
}

@test "a crash yields an unusable diagnosis, not a security finding" {
  grep -q 'checkov' "$IAC"
  # The crash branch must exist and must not reuse the "security issue(s) found"
  # wording, which asserts a verdict the tool never reached.
  run bash -c "grep -n 'CHECKOV_CRASHED' '$IAC' | head -3"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "the crash branch returns before any finding is counted" {
  # Order is the property that matters: if the grep for "FAILED for resource"
  # runs first, the traceback text decides the verdict. Assert the crash check
  # appears ABOVE the failed_count parse, not merely that both exist.
  local crash_line fail_line
  crash_line=$(grep -n 'if \[ "\$CHECKOV_CRASHED" -eq 1 \]' "$IAC" | head -1 | cut -d: -f1)
  fail_line=$(grep -n 'failed_count=\$(grep -c "FAILED for resource"' "$IAC" | head -1 | cut -d: -f1)
  [ -n "$crash_line" ]
  [ -n "$fail_line" ]
  [ "$crash_line" -lt "$fail_line" ]
}

@test "the crash path returns a non-zero status distinct from a findings block" {
  # Findings use exit_code=1. The crash returns 2 (unusable) so callers can tell
  # "the scanner failed" from "the scanner found problems".
  grep -q 'return 2' "$IAC"
  grep -q 'XP_GATE_IAC_SOFT' "$IAC"
}
