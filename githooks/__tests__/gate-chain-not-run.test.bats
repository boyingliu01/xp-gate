#!/usr/bin/env bats
#
# @test REQ-GATE-CHAIN-NOT-RUN
# @intent The quality report prints a row for every gate in XP_GATE_ORDER, and a
#         gate that never ran is indistinguishable from one that ran and skipped.
#
#         Measured: a repo staging a shell file whose Gate 1 fails. The console
#         showed only the gates that executed:
#
#             → Gate 11: Sprint Flow Enforcement...
#             → Gate 12: File hygiene check...
#             → Gate 9: Build integrity...
#             → Gate 1: Code Quality (static analysis + linting)...
#
#         and then the report:
#
#               Gate 1: Code Quality        FAIL
#               Gate 2: Duplicate Code      SKIP
#               Gate 3: Complexity          SKIP (warnings: 0)
#               Gate 4: Principles          SKIP (warnings: 0)
#               Gate 5: Tests + Coverage    SKIP (coverage: N/A%)
#               Gate 6: Architecture        SKIP
#               Gate 7: IaC Security        SKIP
#               Gate 8: Secret Scanning     SKIP
#               Gate 10: SAST Security      SKIP
#
#         Gates 2-8 and 10 did not run. `githooks/gate-driver.sh` exits on the
#         first non-zero return -- fail-fast is the intended behaviour -- so those
#         gate bodies were never invoked and kept the SKIP default from their
#         `GATE_N_STATUS="SKIP"` initialiser at the top of the body.
#
#         So the report answers "skipped" for a gate whose question was never
#         put. That is the "not checked must never be indistinguishable from
#         passed" family once more, in its quietest form: the row is not green,
#         but it is indistinguishable from a gate that genuinely decided to skip,
#         and the reader cannot tell that the chain stopped early.
#
#         Note the ORDER is what makes this load-bearing: 11/12/9 run BEFORE 1,
#         so a Gate 1 failure means the expensive middle of the chain (2,3,4,5,
#         6,7,8,10) is silently unreported. Gate 9 already carries a
#         "skipped in 0s (nothing was verified)" note from an earlier fix; the
#         gates the driver never reached carry nothing.
#
# @covers AC-GATE-CHAIN-NOT-RUN-01
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  DRIVER="$REPO/githooks/gate-driver.sh"
}

@test "AC-GATE-CHAIN-NOT-RUN-01: fail-fast is explicit, and the driver says which gates were not reached" {
  # The behaviour itself is intended, so this test does not ask for the chain to
  # continue. It asks that the early exit be OBSERVABLE: someone reading the run
  # must be able to tell "the chain stopped here" from "each later gate chose to
  # skip".
  grep -q 'exit "\$rc"' "$DRIVER" || {
    echo "the fail-fast exit this test is about is gone; re-derive the finding"
    return 1
  }

  # Require the driver to announce what it did not reach. Either wording is a
  # pass -- what must not happen is silence.
  if grep -qiE 'not reached|not run|did not run|skipped: chain stopped' "$DRIVER"; then
    return 0
  fi

  echo "githooks/gate-driver.sh exits on the first failing gate (intended) but"
  echo "never says which gates it therefore skipped. Measured on a repo whose"
  echo "Gate 1 failed: gates 2-8 and 10 were printed as plain 'SKIP' with no"
  echo "marker, indistinguishable from gates that decided to skip, while the"
  echo "console never mentioned them at all."
  return 1
}