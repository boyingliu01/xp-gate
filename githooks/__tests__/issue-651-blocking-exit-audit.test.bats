#!/usr/bin/env bats
# @test REQ-651
# @intent Failure is invisible in xp-gate's own development, and that is a data gap,
#         not a feeling:
#
#           data source               records   gate FAILs
#           .xp-gate/audit.jsonl        8,258   ~0
#           .quality-history.jsonl        559    0
#
#         Both "quality history" files only record successes. The reason is in the
#         code: pre-commit has ~76 `exit 1` blocking paths, but record_gate_audit()
#         is only reached AFTER a gate settles. The moment a gate FAILs and exits,
#         the record that would have said so is never written.
#
#         Consequence: `xp-gate retro` and `sprint-status --rework-check` compute
#         rework rates over a denominator with no failures in it, so rework trends
#         to zero by construction. Observed independently from session logs: 34% of
#         change->PASS rounds needed at least one rework round.
#
#         The fix must catch the failure on its way OUT, not add a record call to
#         all 76 branches — that would rot the first time someone adds branch 77.
#         An EXIT trap is the only shape that survives new blocking paths.
#
#         Two more requirements, both about honesty of the numbers:
#           - a FAIL record must carry *why* (failure_reason / rule_id), not just
#             passed:false, or the "top10 failing rules" report cannot exist;
#           - the record must not be lost just because the gate exited before its
#             status was finalised.
# @covers AC-670-56, AC-670-57, AC-670-58

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRECOMMIT="$REPO_ROOT/githooks/pre-commit"
}

# AC-670-56: an EXIT trap exists that records blocking outcomes.
@test "AC-670-56: pre-commit installs an EXIT trap that journals blocking exits" {
  [ -f "$PRECOMMIT" ]
  # The trap must be installed near the top so it covers every later `exit 1`.
  grep -qE "trap .*(_record_blocking_exit|record_blocking_exit).* EXIT" "$PRECOMMIT" \
    || { echo "no EXIT trap recording a blocking exit"; return 1; }
  # ...and the handler must actually write into the audit journal.
  grep -qE "_record_blocking_exit\(\)|record_blocking_exit\(\)" "$PRECOMMIT" \
    || { echo "EXIT trap names a handler that does not exist"; return 1; }
}

# AC-670-57: the failure record says why, not just that it failed.
@test "AC-670-57: the blocking record carries a failure reason and the gate identity" {
  local handler=''
  # Pull the handler body (from its definition to the closing brace at column 0).
  handler=$(awk '/^_record_blocking_exit\(\)|^record_blocking_exit\(\)/{f=1} f&&/^}/{exit} f' "$PRECOMMIT")
  [ -n "$handler" ] || { echo "handler body not found"; return 1; }
  for field in gate-id gate-name passed issues-found; do
    printf '%s\n' "$handler" | grep -q -- "--$field" \
      || { echo "record omits --$field"; printf '%s\n' "$handler" | sed -n '1,25p'; return 1; }
  done
  # passed must be false -- a blocking exit is by definition not a pass.
  printf '%s\n' "$handler" | grep -qE '\-\-passed (false|"false")' \
    || { echo "blocking record does not mark passed=false"; return 1; }
  # And the reason must reach the journal, or top-N-by-rule is impossible.
  printf '%s\n' "$handler" | grep -qE '\-\-failure-reason|failure_reason' \
    || { echo "blocking record has no failure reason"; return 1; }
}

# AC-670-58: the trap is idempotent — one commit writes at most one blocking record.
@test "AC-670-58: the blocking journal is written at most once per run" {
  local handler=''
  handler=$(awk '/^_record_blocking_exit\(\)|^record_blocking_exit\(\)/{f=1} f&&/^}/{exit} f' "$PRECOMMIT")
  [ -n "$handler" ] || { echo "handler body not found"; return 1; }
  # Without a latch, an EXIT trap plus a gate that already recorded would double-
  # count every failure and halve the reported first-pass rate.
  printf '%s\n' "$handler" | grep -qE '_BLOCKING_RECORDED|_blocking_recorded|already recorded' \
    || { echo "no idempotence latch: a failure could be journaled twice"; return 1; }
}
