#!/usr/bin/env bats
#
# @test REQ-GATE2-TOOL-ERROR-NOT-PASS
# @intent Two debts in Gate 2 that were recorded rather than fixed, closed here.
#
#         DEBT A -- the Go arm truncated its own file list:
#
#             FILES_TO_CHECK=$(echo "$CHANGED_FILES" | grep "\.go$" | head -20)
#
#         Past twenty .go files the rest were never passed to jscpd and nothing
#         said so. A scan that quietly covers part of the change set is the same
#         lie as one that covers none of it. The same line was also unquoted, so
#         a path containing a space was split into two bad paths (#457 class).
#
#         DEBT B -- the PowerShell and shell arms set no status:
#
#             powershell)
#               echo "SKIPPED - Duplicate code (no tool for PowerShell)"
#             ;;
#
#         GATE_2_STATUS kept its initial "PASS", so the journal recorded a pass
#         for a language that was never scanned. Unlike the three arms fixed
#         earlier, these never CLAIMED to have scanned anything -- but "no
#         verdict" was still being recorded as "passed", which is the one thing
#         the audit must never do.
#
#         Note the direction of both fixes: neither makes Gate 2 block. Debt A
#         makes it scan everything it was asked about; Debt B makes it say
#         "nothing was checked" instead of "all clear".
#
# @covers AC-GATE2-TOOL-ERROR-03 AC-GATE2-TOOL-ERROR-04
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  AUDIT_LOG="$BATS_TEST_TMPDIR/audit.log"
  : > "$AUDIT_LOG"
  # 30 .go files: more than the old head -20 window, so truncation is observable.
  local i
  for i in $(seq 1 30); do
    printf 'package main\n' > "f$i.go"
  done
  SEEN="$BATS_TEST_TMPDIR/seen.txt"
  : > "$SEEN"
}

# Run the Go arm, recording every path jscpd is actually handed.
run_go_arm() {
  G2_ROOT="$REPO" G2_AUDIT="$AUDIT_LOG" G2_SEEN="$SEEN" G2_WORK="$WORK" \
  bash -c '
    cd "$G2_WORK" || exit 1
    source "$G2_ROOT/githooks/gate-entries/gate-2-entry.sh" 2>/dev/null
    PROJECT_LANG=go
    PROJECT_LANGS=go
    DOCS_ONLY_COMMIT=false
    CHANGED_FILES=$(printf "%s\n" $(seq -f "f%g.go" 1 30))
    gate_enabled() { return 0; }
    gate_start_ms() { date +%s%3N; }
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G2_AUDIT"; }
    require_tool() { return 0; }
    # Record the paths, once per path, so batching does not inflate the count.
    jscpd() {
      local a
      for a in "$@"; do
        case "$a" in *.go) printf "%s\n" "$a" >> "$G2_SEEN" ;; esac
      done
      return 0
    }
    gate_2_run
  ' 2>&1
}

@test "AC-GATE2-TOOL-ERROR-03: every .go file is scanned, not the first twenty" {
  run run_go_arm

  local scanned
  scanned=$(wc -l < "$SEEN" | tr -d ' ')
  [ "$scanned" -eq 30 ] || {
    echo "jscpd was handed $scanned of 30 .go files"
    echo "files seen:"
    cat "$SEEN"
    return 1
  }
  # And the gate must still report a normal pass for a successful scan --
  # otherwise "fix truncation" could be satisfied by failing everything.
  [[ "$output" == *"PASSED"* ]] || {
    echo "a successful Go scan no longer passes; output was:"
    printf '%s\n' "$output"
    return 1
  }
}

@test "AC-GATE2-TOOL-ERROR-04: a language with no tool records SKIP, not PASS" {
  # PowerShell: the arm that says "jscpd does not support .ps1".
  G2_ROOT="$REPO" G2_AUDIT="$AUDIT_LOG" bash -c '
    source "$G2_ROOT/githooks/gate-entries/gate-2-entry.sh" 2>/dev/null
    PROJECT_LANG=powershell
    PROJECT_LANGS=powershell
    DOCS_ONLY_COMMIT=false
    CHANGED_FILES="build.ps1"
    gate_enabled() { return 0; }
    gate_start_ms() { date +%s%3N; }
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G2_AUDIT"; }
    gate_2_run
  ' > /dev/null 2>&1

  grep -q '^SKIP' "$AUDIT_LOG" || {
    echo "PowerShell arm recorded no SKIP; journal says: $(cat "$AUDIT_LOG")"
    return 1
  }
  grep -q 'no_tool_for_powershell' "$AUDIT_LOG" || {
    echo "the reason was not journaled: $(cat "$AUDIT_LOG")"
    return 1
  }
}