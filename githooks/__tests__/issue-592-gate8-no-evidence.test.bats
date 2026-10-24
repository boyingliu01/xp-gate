#!/usr/bin/env bats
# @test REQ-603
# @intent Gate 8 must not report a completed, clean scan as "no evidence".
#
#         #592 reports that gitleaks 8.30.1 does not create the --report-path file
#         when the scan is clean, so this branch fires on every clean machine:
#             ⚠️  gitleaks exited 0 but produced no readable report
#             ⏭️  SKIPPED - secret scanning produced no evidence (not a pass)
#         and a successful secret scan is recorded as SKIP forever.
#
#         Measured on this workstation (git-bash, gitleaks 8.30.1): a clean scan
#         DOES write `[]`, so the reported symptom does not reproduce here —
#         issue-493-gate8-clean-report-count.test.bats already pins that with the
#         real binary. It is therefore NOT this suite's job to "fix" a defect it
#         cannot observe. What this suite pins is the part that is true on every
#         platform and was missing: the gate has exactly one response to "exit 0
#         and no report", and it is the same response whether
#             (a) the scan never ran (config unreadable, FTL, bad path), or
#             (b) the scan ran and found nothing but the tool wrote no file.
#         Those are different facts and the operator cannot act on a message that
#         conflates them. (a) must be ENVIRONMENT/BLOCK; (b) is evidence-less and
#         must say so in terms the operator can check.
#
#         The deeper point is the one #449 established and #592 re-opens from the
#         other side: the verdict must rest on the strongest evidence available,
#         in a fixed order — report artifact first, tool failure second, tool
#         output last. Never on whichever signal happens to be convenient.
# @covers AC-603-01, AC-603-02, AC-603-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export REPO_ROOT

  WORKDIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORKDIR"
  # A repo-shaped dir so gate-8.sh's .gitleaks.toml check has somewhere to look.
  ( cd "$WORKDIR" && git init -q . && git config core.hooksPath /dev/null \
    && git config user.email t@t.t && git config user.name t \
    && printf 'const x = 1\n' > ok.ts && git add ok.ts )
}

# Run the shipped gate-8.sh with a stub gitleaks.
#
# STUB_REPORT: what to copy to --report-path (empty string = write nothing)
# STUB_STDOUT: what the stub prints
# STUB_EXIT:   the stub's exit code
run_gate8() {
  local stubdir="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$stubdir"
  cat > "$stubdir/gitleaks" << 'STUB'
#!/bin/bash
for arg in "$@"; do
  case "$arg" in --report-path=*) report_path="${arg#--report-path=}" ;; esac
done
if [ -n "${STUB_REPORT:-}" ] && [ -n "$report_path" ]; then
  cp "$STUB_REPORT" "$report_path"
fi
[ -n "${STUB_STDOUT:-}" ] && printf '%s\n' "$STUB_STDOUT"
exit "${STUB_EXIT:-0}"
STUB
  chmod +x "$stubdir/gitleaks"

  (
    cd "$WORKDIR" || exit 70
    export TMPDIR="$BATS_TEST_TMPDIR"
    export PATH="$stubdir:$PATH"
    export STUB_REPORT STUB_STDOUT STUB_EXIT
    gate_start_ms() { echo "0"; }
    record_gate_audit() { :; }
    GATE_8_STATUS=""
    source "$REPO_ROOT/githooks/gate-8.sh"
    echo "STATUS=$GATE_8_STATUS"
  )
}

@test "AC-603-01: a clean report artifact still passes (the strongest evidence wins)" {
  local clean="$BATS_TEST_TMPDIR/clean.json"
  printf '[]\n' > "$clean"

  # Call the helper directly and capture, rather than `STUB_...=x run_gate8`:
  # env-prefix assignment is not valid syntax for a FUNCTION call in bash, and
  # `run` would replace $output — the helper already runs in a subshell.
  local out
  out=$(STUB_REPORT="$clean" STUB_STDOUT="" STUB_EXIT=0 run_gate8 2>&1)

  [[ "$out" == *"STATUS=PASS"* ]] || {
    echo "a clean report should be the strongest evidence there is:"
    printf '%s\n' "$out" | head -8
    return 1
  }
}

@test "AC-603-02: a tool that fails to run is reported as an environment failure, not as no-evidence" {
  # The scan never happened. Reporting "produced no evidence" tells the operator
  # to distrust the code; reporting the tool failure tells them what to fix.
  #
  # `|| true`: the gate exits 1 here, and that status propagates out of the
  # command substitution into the assignment under errexit — which fails the case
  # on the assignment line before any assertion runs.
  local out
  out=$(STUB_REPORT="" STUB_STDOUT="FTL unable to load config: open .gitleaks.toml: permission denied" STUB_EXIT=0 run_gate8 2>&1) || true

  [[ "$out" != *"STATUS=PASS"* ]] || {
    echo "a fatal tool error must never be a pass"
    return 1
  }
  [[ "$out" == *"ENVIRONMENT"* || "$out" == *"BLOCKED"* ]] || {
    echo "a scan that could not run must say so in terms the operator can act on;"
    echo "got:"
    printf '%s\n' "$out" | head -8
    echo "--- stub sanity: does STUB_STDOUT reach the stub? ---"
    local probe
    probe=$(STUB_STDOUT="probe-line" run_gate8 2>&1)
    if printf '%s\n' "$probe" | grep -q 'probe-line'; then
      echo "stub stdout DOES reach the gate"
    else
      echo "stub stdout does NOT reach the gate (test harness bug, not product)"
    fi
    return 1
  }
  # The message must not claim the scan was clean.
  [[ "$out" != *"No secrets detected"* ]] || {
    echo "claimed a clean scan although the tool reported a fatal error"
    return 1
  }
}

@test "AC-603-03: exit 0 with no report and no failure still does not claim a pass" {
  # Whatever the cause, there is no artifact. The gate may not assert the code is
  # clean from that position — that is #449's rule and it still holds.
  local out
  out=$(STUB_REPORT="" STUB_STDOUT="3:04AM INF scanned ~159 bytes" STUB_EXIT=0 run_gate8 2>&1)

  [[ "$out" != *"STATUS=PASS"* ]] || {
    echo "no artifact and no evidence must not be reported as PASS"
    return 1
  }
  [[ "$out" == *"STATUS=SKIP"* ]] || {
    echo "expected SKIP when there is genuinely no evidence:"
    printf '%s\n' "$out" | head -8
    return 1
  }
}

@test "AC-603-03: findings in the artifact still block" {
  # Control against over-correction: widening the "no report" path must not
  # weaken the finding path.
  local found="$BATS_TEST_TMPDIR/found.json"
  printf '[{"RuleID":"aws-access-token","Secret":"REDACTED"}]\n' > "$found"

  local rc=0
  STUB_REPORT="$found" STUB_STDOUT="" STUB_EXIT=0 run_gate8 >/dev/null 2>&1 || rc=$?

  [ "$rc" -eq 1 ] || {
    echo "a report with a finding must still block (exit 1), got exit $rc"
    return 1
  }
}
