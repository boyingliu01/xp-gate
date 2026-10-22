#!/usr/bin/env bats
# @test REQ-579
# @intent Gate 5 (tests + coverage) distinguishes three outcomes: coverage met,
#         coverage below threshold (BLOCK), and coverage not determinable (WARN,
#         no block). The third bucket is deliberately lenient — a repo whose
#         coverage tool produced no recognised report should not be blocked for a
#         reporting-format mismatch.
#
#         The condition guarding the first two buckets was:
#
#             if [ ... ] && [ "$COVERAGE_PERCENT" -gt 0 ]; then
#                                        ^^^^^^^^^^^^^^^^^^
#             ...block on < threshold ...
#             else
#               echo "⚠️  Could not determine ... coverage percentage."
#
#         `-gt 0` sends a MEASURED 0% into the "could not determine" bucket. Those
#         are not the same claim: 0% means coverage.py (or whichever tool) ran and
#         covered nothing — the suite executed and proved nothing. "Not
#         determinable" means no evidence was produced at all.
#
#         So a project with a test file that asserts nothing, or a tool that
#         reports 0 lines covered, gets a WARNING and a PASSED gate. That is the
#         skip-as-pass failure this project keeps finding: a number that says
#         "nothing is tested" was read as "no number available".
#
#         The installed copy of pre-commit already carries the fix (`-ge 0` plus a
#         comment explaining the distinction); the repo copy did not. This pins the
#         behaviour in the repo so the fix cannot be lost again.
#
#         Note 0 is a valid integer and must reach the threshold comparison;
#         `parse_error` and the empty string must still fall to the WARN branch.
# @covers AC-579-01, AC-579-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  # The coverage decision is one inline `if` inside a large case arm. There are
  # TWO guards on COVERAGE_PERCENT in this hook (an earlier, unrelated one at
  # ~2965); the one under test is the one that compares against a literal, so
  # anchor on THAT. Anchor on the literal comparison rather than the `-n` guard:
  # the bug lives in which operator is used, so a partially-extracted guard would
  # test nothing.
  PREDICATE=$(grep -E '^[[:space:]]*if \[ -n "\$COVERAGE_PERCENT" \].*COVERAGE_PERCENT" -g[te] 0.*then[[:space:]]*$' "$HOOK" | head -1)
}

# Classify a coverage value the same way Gate 5 does: MEASURED (threshold
# comparison runs) or UNDETERMINED (WARN branch).
classify() {
  local COVERAGE_PERCENT="$1"
  local cond
  # Strip the leading `if ` and trailing ` then` to get a bare condition. The
  # condition already carries its own `[ ... ]` test brackets, so it is
  # evaluated directly -- wrapping it in another `[ ... ]` would be a syntax
  # error and every value would silently land in the else branch.
  cond="${PREDICATE#*if }"
  cond="${cond%then*}"
  if eval "$cond" 2>/dev/null; then
    echo MEASURED
  else
    echo UNDETERMINED
  fi
}

@test "AC-579-01: a measured 0% is MEASURED, not undetermined" {
  [ -n "$PREDICATE" ] || {
    echo "could not locate the coverage predicate in githooks/pre-commit -- the anchor drifted"
    return 1
  }
  local result
  result=$(classify 0)
  [ "$result" = "MEASURED" ] || {
    echo "a 0% coverage reading was classified as UNDETERMINED, so a suite that tested nothing passes the gate"
    echo "predicate: $PREDICATE"
    return 1
  }
}

@test "AC-579-02: the undetermined bucket still catches no-data cases" {
  [ -n "$PREDICATE" ] || return 1
  # These must NOT be treated as measured: absent, explicitly unparseable, and
  # any non-numeric value.
  for value in "" "parse_error" "n/a"; do
    local result
    result=$(classify "$value")
    [ "$result" = "UNDETERMINED" ] || {
      echo "'$value' was classified as MEASURED -- the WARN branch has been closed off"
      return 1
    }
  done
}
