#!/usr/bin/env bats
#
# @test REQ-G5C-NO-NPLUS1 the REQ-ID list is resolved once, not once per annotation
# @intent Gate 5c runs a nested loop over staged test files x @test annotations.
#         The REQ-ID list was resolved INSIDE the inner loop:
#
#             found=$(gate_5c_req_ids "$req_ids_file" | grep -qxF "$req_id" ...)
#
#         gate_5c_req_ids shells out to jq (or grep) every time, so every
#         annotation in every staged test file re-parsed the same file -- an N+1
#         query. This repo has 1097 test files.
#
#         Measured with the segment clock now recorded in the audit detail:
#
#             seg=pre:103ms,5a:1886ms,5b:3711ms,5c:4413ms,total:15347ms
#
#         Gate 5c alone was 4.4 s of a 15.3 s gate.
#
#         The reverse check 20 lines below already hoisted its own call; this loop
#         was the one that did not.
#
#         WHY THIS TEST COUNTS CALLS AND NOT MILLISECONDS: the fix's wall-clock
#         gain could not be measured honestly -- the post-fix sample was taken at
#         100% CPU load against a 32%-load baseline, and rule 6 says those two are
#         not comparable. Call count is deterministic and load-independent, so it
#         is the honest proof. It pins the STRUCTURE that removes the N+1; the
#         magnitude stays unclaimed until the load drops.
#
# @covers AC-G5C-NO-NPLUS1-01 gate_5c_req_ids is not called from inside the loop
# @covers AC-G5C-NO-NPLUS1-02 the hoisted result is actually used per annotation
# @covers AC-G5C-NO-NPLUS1-03 the reverse-check call stays hoisted too (regression guard)
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO/githooks/lib/gate-5c-alignment.sh"
}

# The annotation loop spans from `while read -r tf` down to its `done` line.
# Anything strictly INSIDE that span must not call gate_5c_req_ids. A call
# BETWEEN two loops is a correct hoist and is allowed.
_annotation_loop_span() {
  local s e
  s=$(grep -n 'while read -r tf' "$LIB" | head -1 | cut -d: -f1)
  e=$(awk -v s="$s" 'NR>s && /done < <\(gate_5c_annotations/ {print NR; exit}' "$LIB")
  printf '%s %s
' "$s" "$e"
}

# AC-G5C-NO-NPLUS1-01
@test "AC-G5C-NO-NPLUS1-01: gate_5c_req_ids is never called inside the annotation loop" {
  local s e
  read -r s e <<< "$(_annotation_loop_span)"
  [ -n "$s" ] && [ -n "$e" ] || {
    echo "could not locate the annotation loop"; return 1; }

  # Strictly inside: the `while` line itself is the loop header, and the
  # hoisted call sits ABOVE it, so both endpoints are excluded.
  local bad
  bad=$(grep -n 'gate_5c_req_ids "' "$LIB"         | awk -F: -v s="$s" -v e="$e" '$1 > s && $1 < e {print}')
  [ -z "$bad" ] || {
    echo "gate_5c_req_ids is still called inside the annotation loop:"
    printf '%s
' "$bad"
    echo "(each call re-shells out to jq for the same file -- an N+1 query)"
    return 1
  }
}

# AC-G5C-NO-NPLUS1-02
@test "AC-G5C-NO-NPLUS1-02: the hoisted list is what the inner loop searches" {
  # A hoist that nobody reads changes nothing: the loop would then match nothing
  # and every annotation would be reported as unknown.
  local block
  block=$(awk '/while read -r req_id/,/done < <\(gate_5c_annotations/' "$LIB")
  printf '%s' "$block" | grep -q 'known_reqs' || {
    echo "the inner loop does not use the hoisted known_reqs"
    echo "-> either the hoist is dead code, or the loop searches something else"
    return 1
  }
}

# AC-G5C-NO-NPLUS1-03: the reverse check near the bottom already hoisted its call
# before this fix. Pin it so a later refactor cannot reintroduce the same pattern
# in the sibling loop.
@test "AC-G5C-NO-NPLUS1-03: the reverse check's call stays hoisted" {
  grep -q 'all_reqs=$(gate_5c_req_ids' "$LIB" || {
    echo "the reverse check no longer hoists its req-id call"
    return 1
  }
}
