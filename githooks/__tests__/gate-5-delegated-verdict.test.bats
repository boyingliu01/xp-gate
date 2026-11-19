#!/usr/bin/env bats
#
# @test REQ-GATE5-DELEGATED-NOT-PASS A gate that delegated its work to CI must
#       not then print a PASSED line for the work it did not do
# @intent The shell adapter declares `tests_delegated_to_ci()` and says so:
#
#             shell: tests run in CI bats-contracts job (scripts/run-bats-ci.cjs),
#             not at commit time.
#             Not checked by this gate -- verified on push/PR instead.
#
#         and Gate 5 prints, six lines later, unconditionally:
#
#             PASSED - Coverage check completed.
#
#         Measured 2026-11-19 on a shell fixture whose only .bats test is
#         `[ 1 -eq 2 ]`:
#
#             Running tests...
#             shell: tests run in CI bats-contracts job ...
#                Not checked by this gate -- verified on push/PR instead.
#             Running coverage check...
#             Shell coverage not available
#             Coverage enforcement not applicable for shell
#             PASSED - Coverage check completed.
#
#         A scripted reader greps the log for PASSED, finds it, and concludes the
#         shell tests passed. The delegation was recorded correctly and then
#         contradicted by the last line, and the last line is the one a summary
#         keeps.
#
#         This is the same defect family as `SKIP must be recorded, not merely
#         printed` in githooks/AGENTS.md, with the polarity reversed: here SKIP
#         was printed and then overwritten by a PASS.
#
#         The fix is not to remove the delegation -- running 239 bats suites
#         serially in a hook measured 18m47s and CI owns that job deliberately.
#         It is to make the printed verdict agree with the decision: when the
#         tests were delegated, say CHECKED IN CI, not PASSED.
#
# @covers AC-GATE5-DELEG-NOT-PASS-01  a delegated run does not print PASSED for tests
# @covers AC-GATE5-DELEG-NOT-PASS-02  a real (non-delegated) run still prints PASSED
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

@test "AC-GATE5-DELEG-NOT-PASS-01: the coverage verdict is not PASSED when tests were delegated" {
  # Pin the property at the source level: the verdict line must be conditional on
  # the gate having actually run a test. A structural test is the right tool here
  # because running gate_5_run end to end executes this repo's whole suite.
  local line
  # Match the ECHO, not the phrase: the fix's own explanatory comment quotes the
  # old output verbatim, and an earlier version of this test matched that comment,
  # computed its line number, found the guard text inside the comment block, and
  # passed for the wrong reason. Match what the shell executes.
  line=$(grep -n 'echo "✅ PASSED - Coverage check completed' "$GATE" | head -1 | cut -d: -f1)

  [ -n "$line" ] || {
    echo "the coverage verdict line is gone; update this test rather than delete it"
    false
  }

  # The guard must be CODE, not prose. The first version of this test searched the
  # 30 lines above the verdict for the word "delegated" and was satisfied by the
  # fix's own explanatory comment -- so it stayed green after the guard was
  # removed, which is the exact failure mode these tests exist to prevent. Strip
  # comments before looking, and require an actual conditional.
  local window code
  window=$(sed -n "$((line > 30 ? line - 30 : 1)),$((line - 1))p" "$GATE")
  code=$(printf '%s\n' "$window" | sed 's/#.*//')

  printf '%s' "$code" | grep -qE 'if .*DELEGATED_LANGS' || {
    echo "the coverage verdict is printed unconditionally -- a delegated run still says PASSED"
    echo "the 30 lines above the PASSED echo contain no 'if ... DELEGATED_LANGS' guard"
    false
  }
}

@test "AC-GATE5-DELEG-NOT-PASS-02: the gate still has a PASSED path for a real run" {
  # Anti-vacuity. If the verdict line were simply deleted, every project would
  # stop reporting that its tests ran -- trading one silent state for another.
  grep -q 'PASSED - Coverage check completed' "$GATE" || {
    echo "no PASSED path remains: a real run would no longer report success"
    false
  }
}
