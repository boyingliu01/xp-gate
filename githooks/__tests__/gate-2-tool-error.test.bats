#!/usr/bin/env bats
#
# @test REQ-GATE2-TOOL-ERROR-NOT-PASS
# @intent Gate 2 had one branch that consulted jscpd's outcome and one that did
#         not, and the ones that did not still printed a pass.
#
#         The Go arm:
#
#             jscpd $FILES_TO_CHECK > "$GO_JSCPD_TMP" 2>&1
#             JSCPD_GO_EXIT=$?
#             if [ "$JSCPD_GO_EXIT" -ne 0 ]; then
#               echo "⚠️  jscpd (Go) exited with code $JSCPD_GO_EXIT"
#             fi
#           fi
#           echo "✅ PASSED - Go duplicate code check completed."     <-- unconditional
#
#         The generic arm had the identical shape. Measured with a jscpd stub
#         exiting 1 (Go) and 2 (generic):
#
#             ⚠️  jscpd (Go) exited with code 1
#             ✅ PASSED - Go duplicate code check completed.
#             [audit] status=PASS
#
#         The TypeScript arm already had this right (#477: `classify_jscpd_run`
#         distinguishes "duplicates" from "error", and the error case sets SKIP).
#         Two of the three arms never got that treatment, so a tool that failed to
#         run was recorded as a clean scan.
#
#         Note what this test does NOT assert: that a failing jscpd BLOCKS. It must
#         not -- a tool that could not run is not a code verdict. What it must do
#         is stop claiming a pass, which is the SKIP verdict plus a reason.
#
# @covers AC-GATE2-TOOL-ERROR-01 AC-GATE2-TOOL-ERROR-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  AUDIT_LOG="$BATS_TEST_TMPDIR/audit.log"
  : > "$AUDIT_LOG"
}

# Drive gate_2_run for one language with jscpd stubbed to fail.
#   $1 = PROJECT_LANG, $2 = changed file, $3 = jscpd exit code
run_gate2_with_failing_tool() {
  G2_LANG="$1" G2_FILE="$2" G2_EXIT="$3" \
  G2_ROOT="$REPO" G2_AUDIT="$AUDIT_LOG" bash -c '
    source "$G2_ROOT/githooks/gate-entries/gate-2-entry.sh" 2>/dev/null
    PROJECT_LANG="$G2_LANG"
    PROJECT_LANGS="$G2_LANG"
    DOCS_ONLY_COMMIT=false
    CHANGED_FILES="$G2_FILE"
    gate_enabled() { return 0; }
    gate_start_ms() { date +%s%3N; }
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G2_AUDIT"; }
    require_tool() { return 0; }
    resolve_jscpd_config() { printf ""; }
    jscpd_default_ignore_patterns() { printf "default"; }
    jscpd_is_default_ignored() { return 1; }
    classify_jscpd_run() { printf "error"; }
    jscpd() { printf "stub: tool failed\n"; return "$G2_EXIT"; }
    gate_2_run
  ' 2>&1
}

@test "AC-GATE2-TOOL-ERROR-01: a failing jscpd in the Go arm is not a pass" {
  run run_gate2_with_failing_tool go "main.go" 1

  [[ "$output" != *"✅ PASSED - Go duplicate code check completed"* ]] || {
    echo "the Go arm claimed a pass after jscpd failed; output was:"
    printf '%s\n' "$output"
    return 1
  }
  grep -q '^SKIP' "$AUDIT_LOG" || {
    echo "the journal did not record SKIP; got: $(cat "$AUDIT_LOG")"
    return 1
  }
}

@test "AC-GATE2-TOOL-ERROR-02: a failing jscpd in the generic arm is not a pass" {
  run run_gate2_with_failing_tool rust "main.rs" 2

  [[ "$output" != *"✅ PASSED - jscpd check completed."* ]] || {
    echo "the generic arm claimed a pass after jscpd failed; output was:"
    printf '%s\n' "$output"
    return 1
  }
  grep -q '^SKIP' "$AUDIT_LOG" || {
    echo "the journal did not record SKIP; got: $(cat "$AUDIT_LOG")"
    return 1
  }
}