#!/usr/bin/env bats
#
# @test REQ-NOT-REACHED a gate the chain never reached is not recorded as SKIP
# @intent The driver fails fast: the first blocking gate stops the commit. The report
#         still prints a row for EVERY gate, and until now every status was written as
#         ${GATE_N_STATUS:-SKIP}. A gate body that never ran never sets the variable,
#         so "the chain stopped before this gate" and "this gate decided to skip"
#         produced the identical report row.
#
#         The console half of this was fixed earlier -- the driver prints
#
#             "Chain stopped at Gate 1 -- these gates were NOT reached: 2 3 8 10 7 5 6 4"
#
#         but the machine-readable half was not. Measured 2026-11-20, iac fixture,
#         Gate 1 blocking:
#
#             console: chain stopped, NOT reached: 2 3 8 10 7 5 6 4
#             report : gate7_iac_security {"status":"SKIP","scanned_files":0}
#
#         The matrix analyser read that SKIP as "Gate 7 ran and found nothing", then
#         reported "iac: the planted defect was not caught by G7" -- a wrong verdict
#         produced by the REPORT against a gate whose body had never been invoked.
#
#         This is the same rule the project keeps re-learning, one channel over:
#         "not checked" must never be indistinguishable from "checked and clean".
#
# @covers AC-NR-01  the driver exports the not-reached list for the report writer
# @covers AC-NR-02  an unreached gate reports NOT_REACHED, not SKIP
# @covers AC-NR-03  a gate that RAN keeps its own status, including SKIP
# @covers AC-NR-04  the report stays valid JSON (the helper must live outside the heredoc)
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  DRIVER="$REPO/githooks/gate-driver.sh"
  G13="$REPO/githooks/gate-entries/gate-13-entry.sh"
}

@test "AC-NR-01: the driver exports XP_GATE_NOT_REACHED before exiting" {
  grep -q 'XP_GATE_NOT_REACHED' "$DRIVER" || {
    echo "the driver never publishes which gates it did not reach"
    false
  }
  # Must be exported, not merely set: the report writer runs later, from the EXIT
  # trap, and reads it in that context.
  grep -q 'export XP_GATE_NOT_REACHED' "$DRIVER" || {
    echo "XP_GATE_NOT_REACHED is set but not exported, so the report writer cannot see it"
    false
  }
}

@test "AC-NR-02: gate_key_status reports NOT_REACHED for an unreached key" {
  # Exercise the real function in isolation: set the list, call it with a key that has
  # no status variable, and assert the answer.
  run bash -c '
    XP_GATE_NOT_REACHED="2 3 8 10 7 5 6 4"
    # Pull just the function out of the gate file rather than sourcing the whole
    # report generator.
    eval "$(sed -n "/^  gate_key_status() {/,/^  }$/p" "$1" | sed "s/^  //")"
    echo "G7=$(gate_key_status 7)"
    echo "G9=$(gate_key_status 9)"
  ' _ "$G13"

  printf '%s' "$output" | grep -q 'G7=NOT_REACHED' || {
    echo "an unreached gate was not marked NOT_REACHED:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-NR-03: a gate that RAN keeps its own status, even SKIP" {
  # Anti-over-reach. If every gate came back NOT_REACHED whenever the list was set,
  # the report would lose the distinction in the other direction -- a gate that ran
  # and chose to skip is a real decision and must survive.
  run bash -c '
    XP_GATE_NOT_REACHED="2 3 8 10 7 5 6 4"
    GATE_7_STATUS="SKIP"
    eval "$(sed -n "/^  gate_key_status() {/,/^  }$/p" "$1" | sed "s/^  //")"
    echo "RAN_SKIP=$(gate_key_status 7)"
    echo "NOT_REACHED=$(gate_key_status 2)"
  ' _ "$G13"

  printf '%s' "$output" | grep -q 'RAN_SKIP=SKIP' || {
    echo "a gate that ran and skipped was overwritten:"
    printf '%s\n' "$output"
    false
  }
  printf '%s' "$output" | grep -q 'NOT_REACHED=NOT_REACHED' || {
    echo "an unreached gate was not marked:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-NR-04: the report template still contains no shell comments" {
  # A regression guard for a mistake I made while writing this fix: inserting the
  # helper's explanatory comment INSIDE the `cat > "$REPORT_FILE" << ENDJSON`
  # heredoc emitted those comment lines into the JSON and produced an unparseable
  # report -- which the commit hook did not notice, because nothing parsed it there.
  # Measured: "SyntaxError: Expected double-quoted property name in JSON at position
  # 894" on the very first end-to-end run.
  run bash -c '
    L=$(grep -n "\"gates\": {" "$1" | head -1 | cut -d: -f1)
    E=$(awk -v s="$L" "NR>=s && /^ENDJSON\$/ {print NR; exit}" "$1")
    [ -n \"$E\" ] || { echo NO_ENDJSON; exit 1; }
    awk -v s=\"$L\" -v e=\"$E\" "NR>s && NR<e && /^[[:space:]]*#/" "$1" | head -3
  ' _ "$G13"

  [ -z "$output" ] || {
    echo "shell comments inside the JSON heredoc will corrupt the report:"
    printf '%s\n' "$output"
    false
  }
}
