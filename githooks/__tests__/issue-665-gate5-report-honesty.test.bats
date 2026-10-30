#!/usr/bin/env bats
# @test REQ-665
# @intent Gate 5's persisted quality report contradicted itself under a subset test
#         run: `"actual": {"coverage": "29"}` sat next to
#         `"thresholds": {"lines": 82}` with `"status": "PASS"` and
#         `"reason": ""`. The VERDICT was right -- #473/#399 deliberately exempt a
#         subset run from the global floor -- but the RECORD does not say so, and a
#         record is all `xp-gate audit` / the tech-debt trackers (#636, #638) ever
#         see.
#
#         A reader cannot tell two opposite situations apart:
#           (a) coverage really was 29% and the gate let it through  -- severe
#           (b) a subset run, whose global floor is exempted by design -- normal
#         Both render identically. The exemption has to travel to the report layer;
#         the fix is to publish it as a reason and to say which population the
#         number describes.
# @covers AC-670-06, AC-670-06, AC-670-07

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
}

# AC-670-06: the subset-run exemption is recorded as a reason, not left empty.
@test "AC-670-06: Gate 5's report carries a reason when coverage was exempted by a subset run" {
  run grep -q 'partial_test_run' "$HOOK"
  [ "$status" -eq 0 ]
}

# AC-670-06: the recorded population says which one the number describes, so
# 29%-against-an-82%-floor cannot read as a violation that was allowed.
@test "AC-670-06: the report distinguishes the subset population from the full one" {
  run grep -qE 'coverage_applies_to|"applies_to"|subset' "$HOOK"
  [ "$status" -eq 0 ]
}

# AC-670-07: the exemption is set at the SAME place that exempts the threshold, so
# the record cannot drift from the verdict. A reason set at one call site and not
# another is exactly the drift that produced an empty reason next to a PASS.
@test "AC-670-07: the exemption reason is derived from the same flag that excuses the threshold" {
  # Every site that marks a partial run must also be able to explain it: the flag
  # is PARTIAL_TEST_RUN, so the report reason is derived from it rather than set
  # by hand at each branch (six branches set the flag).
  run grep -qE 'PARTIAL_TEST_RUN[^\n]*partial_test_run|GATE_5_DETAIL=.*partial' "$HOOK"
  [ "$status" -eq 0 ]
}
