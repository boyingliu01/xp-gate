#!/usr/bin/env bats
#
# @test REQ-SKIP-REASON gate 12/12b/12c record WHY they skipped
# @intent githooks/AGENTS.md states the invariant plainly: "SKIP must be recorded,
#         not merely printed", and the corollary -- "a green gate-coverage row with
#         no reason attached is a bug, not a pass".
#
#         record_gate_audit takes an optional 6th argument for exactly this. Three
#         gates did not pass it:
#
#             gate-12  : 2 SKIP sites, 0 DETAIL assignments
#             gate-12b : assigned GATE_12B_DETAIL then did not pass it
#             gate-12c : assigned GATE_12C_DETAIL then did not pass it
#
#         The last two are the same shape as the Gate 6 defect fixed in 164aef36:
#         the variable was populated and then dropped on the floor, so the journal
#         recorded a bare SKIP with nothing to distinguish "not selected" from
#         "the script is missing".
#
#         This cannot be caught by a status assertion -- SKIP was set correctly in
#         every case. What was missing is the reason, one channel further out.
#
# @covers AC-SKIP-REASON-01  every record_gate_audit call in 12/12b/12c passes a detail
# @covers AC-SKIP-REASON-02  every SKIP site sets a DETAIL before recording
# @covers AC-SKIP-REASON-03  gate 12's two skip sites do not share a fabricated reason
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-SKIP-REASON-01: every record_gate_audit call in 12/12b/12c passes a detail" {
  local f missing=""
  for f in gate-12 gate-12b gate-12c; do
    local path="$REPO/githooks/gate-entries/${f}-entry.sh"
    [ -f "$path" ] || { missing="$missing $f(missing)"; continue; }
    # A correct call has exactly six arguments after the function name. Count the
    # quoted arguments rather than pattern-matching the tail: the 5th is either a
    # literal or a $( ... ) command substitution, and pinning that shape made the
    # check reject a perfectly good call.
    local bad
    bad=$(grep -n 'record_gate_audit' "$path" \
      | grep -vE '^[0-9]+:\s*#' \
      | while IFS= read -r line; do
          # Strip the leading "NN:" and count top-level quoted args.
          body="${line#*:}"
          n=$(printf '%s' "$body" | grep -oE '"[^"]*"|\$\([^)]*\)' | wc -l)
          [ "$n" -ge 6 ] || printf '%s\n' "$line"
        done)
    [ -z "$bad" ] || missing="$missing $f"
  done

  [ -z "$missing" ] || {
    echo "record_gate_audit called without a detail argument in:$missing"
    echo "-> the journal records a SKIP with no reason, and nothing distinguishes"
    echo "-> 'not selected' from 'the script is missing'"
    for f in gate-12 gate-12b gate-12c; do
      echo "--- $f ---"
      grep -n 'record_gate_audit' "$REPO/githooks/gate-entries/${f}-entry.sh" || true
    done
    false
  }
}

@test "AC-SKIP-REASON-02: every SKIP site sets a DETAIL before recording" {
  local f varbase
  for f in 12 12b 12c; do
    local path="$REPO/githooks/gate-entries/gate-${f}-entry.sh"
    # GATE_12_STATUS -> GATE_12_DETAIL, GATE_12B_STATUS -> GATE_12B_DETAIL, ...
    case "$f" in
      12)   varbase="GATE_12" ;;
      12b)  varbase="GATE_12B" ;;
      12c)  varbase="GATE_12C" ;;
    esac
    local skips details
    skips=$(grep -c "${varbase}_STATUS=\"SKIP\"" "$path" || true)
    details=$(grep -c "${varbase}_DETAIL=" "$path" || true)
    [ "$details" -ge "$skips" ] || {
      echo "$f: $skips SKIP site(s) but only $details ${varbase}_DETAIL assignment(s)"
      grep -n "${varbase}_STATUS=\"SKIP\"" -A3 "$path" || true
      false
    }
  done
}

@test "AC-SKIP-REASON-03: gate 12's two skip sites carry distinguishable reasons" {
  # 'not selected by XP_GATE_ONLY_GATE' and 'the gate script is missing' have
  # different remedies -- one is a configuration choice, the other is a broken
  # install. Recording one shared string for both would satisfy AC-01 and AC-02
  # while losing the only information the field exists to carry.
  local path="$REPO/githooks/gate-entries/gate-12-entry.sh"
  local reasons
  reasons=$(grep -oE 'GATE_12_DETAIL="[^"]+"' "$path" | sed 's/.*="//; s/"$//' | sort -u | wc -l)
  [ "$reasons" -ge 2 ] || {
    echo "gate-12 uses $reasons distinct DETAIL value(s) across its skip sites"
    grep -n 'GATE_12_DETAIL=' "$path" || true
    echo "-> 'not_selected' and 'script_not_found' are different problems"
    false
  }
}
