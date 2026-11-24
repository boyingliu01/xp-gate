#!/usr/bin/env bats
#
# @test REQ-GATE5-STATUS-NO-REGRESS A later language must not downgrade a verdict
#       a real check already produced
# @intent Gate 5 iterates PROJECT_LANGS in config order (typescript, shell,
#         powershell, iac) and every iteration may write GATE_5_STATUS.
#
#         Measured 2026-11-24 over 343 audit records: gate-5 has 0 PASS, 21 SKIP,
#         and all 13 explained skips read "powershell: no Pester tests" -- in a
#         repo that carries thousands of TypeScript tests. The gate has never
#         enforced anything here.
#
#         The mechanism is ordering, not absence. The powershell branch contained:
#
#             if [ "$GATE_5_STATUS" = "PASS" ]; then
#               GATE_5_STATUS="SKIP"
#             fi
#
#         so a run where TypeScript tests genuinely executed and passed was
#         rewritten to SKIP by a later language that had nothing to measure.
#
#         Same family as "SKIP must be recorded, not merely printed" with the
#         polarity reversed: here a real PASS is overwritten by a SKIP. A
#         language with nothing to measure must not speak for the ones that did.
#
# @covers AC-GATE5-NO-REGRESS-01  the powershell skip no longer demotes a PASS
# @covers AC-GATE5-NO-REGRESS-02  the skip still records its reason for the case it is the only verdict
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
  [ -f "$GATE5" ] || skip "gate-5-entry.sh not found"
  # The powershell arm only: from its case label to the closing ';;'.
  ARM="$(awk '/^    "powershell"\)/ { inside = 1 }
              inside { print }
              inside && /^      ;;/ { exit }' "$GATE5")"
}

@test "AC-GATE5-NO-REGRESS-01: the powershell arm does not demote PASS to SKIP" {
  [ -n "$ARM" ]
  echo "$ARM" | grep -q 'no Pester tests' || skip "powershell arm shape changed"

  # A demotion is the `[ "$GATE_5_STATUS" = "PASS" ]` guard around a SKIP write.
  # Comments are stripped first: the fixed replacement documents the old shape,
  # and quoting it there must not read as the defect still being present.
  # Fixed-string match so nothing is expanded by the test shell.
  local code
  code="$(echo "$ARM" | sed 's/^[[:space:]]*#.*$//')"
  if echo "$code" | grep -qF -- '[ "$GATE_5_STATUS" = "PASS" ]'; then
    echo "powershell arm still demotes an existing PASS to SKIP"
    return 1
  fi

  # The safe shape: only claim SKIP when no verdict exists yet.
  echo "$code" | grep -qF -- '[ -z "${GATE_5_STATUS:-}" ]' || {
    echo "expected the skip to apply only when no verdict exists yet"
    return 1
  }
}

@test "AC-GATE5-NO-REGRESS-02: the powershell skip still records a reason" {
  [ -n "$ARM" ]
  echo "$ARM" | grep -q 'GATE_5_DETAIL' || {
    echo "the skip must still carry a reason into the audit"
    return 1
  }
  echo "$ARM" | grep -q 'no Pester tests'
}
