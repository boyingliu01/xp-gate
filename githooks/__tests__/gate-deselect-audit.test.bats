#!/usr/bin/env bats
#
# @test REQ-GATE-DESELECT-AUDIT
# @intent "SKIP must be recorded, not merely printed" is one of this project's
#         core contracts, and it was already the subject of a fix for gate-12b/12c.
#         But the earlier test only caught gates whose file contained NO
#         record_gate_audit call at all. A gate that records on its MAIN path and
#         stays silent when deselected passed that test -- and five gates are in
#         exactly that state:
#
#             gate-6  architecture       deselect -> return 0, no record
#             gate-9  build-integrity    deselect -> return 0, no record
#             gate-11 sprint-flow        deselect -> return 0, no record
#             gate-12 file-hygiene       deselect -> return 0, no record
#             gate-13 compiler-strictness deselect -> return 0, no record
#
#         Consequence: with XP_GATE_ONLY_GATE selecting a subset, the journal
#         records only the gates that ran. The deliberately skipped ones leave
#         nothing, so "deselected on purpose" and "not part of this chain" are
#         identical to every consumer -- the same defect family, one level down
#         from where the last fix stopped.
#
#         This is a BEHAVIOURAL test, not a text scan: it sources each gate entry
#         with a stub environment, invokes gate_<KEY>_run while deselected, and
#         asserts record_gate_audit was called. A grep for `record_gate_audit`
#         cannot distinguish "called on every path" from "called on one path",
#         which is precisely how these five escaped.
#
#         Gate 0 is deliberately excluded: on a protected branch it rejects ANY
#         XP_GATE_ONLY_GATE before the deselect arm is reachable, so the state this
#         test builds does not exist for it. Its status chain is followed by an
#         UNCONDITIONAL record_gate_audit call, asserted separately below.
#
# @covers AC-GATE-DESELECT-01 AC-GATE-DESELECT-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# Run one gate's body while it is deselected, and print what it recorded.
#
# The stub environment is the minimum the gate bodies touch before their
# gate_enabled check: the selection helper, the two clocks, and the three change
# set variables. Everything else they might reach is behind a branch this state
# does not enter, and a failure there surfaces as a non-empty stderr rather than a
# silent pass, because the assertion is on the RECORDED value.
run_deselected_gate() {
  local key="$1"
  bash -c "
    cd '$REPO_ROOT' || exit 9
    export PROJECT_ROOT='$REPO_ROOT'
    export GATE_DIR='$REPO_ROOT/githooks'
    export CHANGED_FILES='' STAGED_FILES='' PROJECT_SUBDIR=''
    # Select a real gate that is not the one under test and not gate 0 (gate 0
    # refuses a synthetic selection on a protected branch).
    export XP_GATE_ONLY_GATE='4'
    gate_selection_active() { return 0; }
    gate_enabled() {
      case \",\${XP_GATE_ONLY_GATE},\" in *\",\$1,\"*) return 0 ;; *) return 1 ;; esac
    }
    gate_start_ms() { echo 1000; }
    now_ms() { echo 2000; }
    RECORDED=''
    record_gate_audit() { RECORDED=\"\${RECORDED} \$1\"; }
    . 'githooks/gate-entries/gate-${key}-entry.sh' 2>/dev/null || { echo 'LOAD_FAILED'; exit 0; }
    fn='gate_${key}_run'
    declare -F \"\$fn\" >/dev/null 2>&1 || { echo 'NO_FUNCTION'; exit 0; }
    \"\$fn\" >/dev/null 2>&1
    echo \"RECORDED=\${RECORDED}\"
  " 2>/dev/null
}

@test "AC-GATE-DESELECT-01: a deselected gate records its skip" {
  local failures=""
  for key in 1 2 3 4 5 6 7 8 9 10 11 12 12b 12c 13; do
    local out
    out="$(run_deselected_gate "$key")"
    case "$out" in
      *LOAD_FAILED*|*NO_FUNCTION*)
        failures="${failures} gate-${key}(${out})"
        ;;
      "RECORDED=")
        # Empty recorded list: the gate set SKIP and returned without a line.
        failures="${failures} gate-${key}"
        ;;
    esac
  done
  [ -z "$failures" ] || {
    echo "these gates leave no journal line when deselected:${failures}"
    return 1
  }
}

@test "AC-GATE-DESELECT-01: the recorded gate id is the gate's own" {
  # A gate that records under someone else's id is worse than one that records
  # nothing: the journal then attributes a skip to a gate that ran.
  local key out
  for key in 12b 12c 13; do
    out="$(run_deselected_gate "$key")"
    [[ "$out" == *"gate-${key}"* ]] || {
      echo "gate-${key} did not record under its own id: $out"
      return 1
    }
  done
}

@test "AC-GATE-DESELECT-02: gate 0 records unconditionally after its status chain" {
  # Gate 0 cannot be exercised via the deselect path here (it rejects a synthetic
  # XP_GATE_ONLY_GATE on a protected branch before reaching that arm), so the
  # contract is asserted structurally instead: the audit call must sit OUTSIDE the
  # status if/else, i.e. at the same or lower indentation as the chain's closing
  # `fi`, with no branch between it and the end.
  run bash -c "
    cd '$REPO_ROOT' || exit 9
    # The last record_gate_audit for gate-0 must be unindented relative to the
    # gate body, which is how the final unconditional call is written.
    awk '/record_gate_audit \"gate-0\"/ {last=NR; line=\$0} END {print last\":\"line}' \
      githooks/gate-entries/gate-0-entry.sh
  "
  [ "$status" -eq 0 ]
  # An unindented `record_gate_audit` at column 0 is the unconditional one; the
  # branch-local calls are all indented deeper.
  [[ "$output" == *":record_gate_audit"* ]] || {
    echo "gate-0's final audit call is not unconditional: $output"
    return 1
  }
}
@test "AC-GATE-DESELECT-01: gate 13's kill switch records a skip" {
  # A distinct arm from deselection, and independently regressable: the kill
  # switch is the documented emergency exit, so the journal must show that the
  # gate was turned off deliberately rather than never present.
  local out
  out="$(bash -c "
    cd '$REPO_ROOT' || exit 9
    export PROJECT_ROOT='$REPO_ROOT'
    export GATE_DIR='$REPO_ROOT/githooks'
    export CHANGED_FILES='' STAGED_FILES='' PROJECT_SUBDIR=''
    export XP_GATE_ONLY_GATE='4'
    export XP_GATE_DISABLE_13='1'
    gate_selection_active() { return 0; }
    gate_enabled() {
      case \",\${XP_GATE_ONLY_GATE},\" in *\",\$1,\"*) return 0 ;; *) return 1 ;; esac
    }
    gate_start_ms() { echo 1000; }
    now_ms() { echo 2000; }
    RECORDED=''
    record_gate_audit() { RECORDED=\"\${RECORDED} \$1\"; }
    . 'githooks/gate-entries/gate-13-entry.sh' 2>/dev/null
    gate_13_run >/dev/null 2>&1
    echo \"RECORDED=\${RECORDED}\"
  " 2>/dev/null)"
  [[ "$out" == *"gate-13"* ]] || {
    echo "gate-13's kill-switch arm recorded nothing: $out"
    return 1
  }
}
