#!/usr/bin/env bats
# @test REQ-548 gate-10.sh is shellcheck-clean
# @intent Verify the shipped gate-10.sh produces no shellcheck warnings, because
#         any repo that vendors it into githooks/ runs Gate 1 shellcheck over it
#         and gets BLOCKED by warnings that are artifacts of the lint scope.
#         #548: gate-10.sh assigns GATE_10_REASON / GATE_10_SCANNED_FILES which
#         only the SOURCING PARENT consumes; single-file shellcheck cannot see
#         that and flags each assignment as SC2034 (appears unused).
# @covers AC-548-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE10="$REPO_ROOT/githooks/gate-10.sh"
}

@test "anti-vacuity: gate-10.sh exists and is a real gate" {
  [ -f "$GATE10" ]
  grep -q 'GATE_10_REASON' "$GATE10"
}

@test "shellcheck reports no findings for gate-10.sh" {
  # If shellcheck is not installed the assertion is vacuous, so skip rather
  # than pass silently -- a green tick that means "not checked" is the failure
  # mode this repo keeps chasing.
  if ! command -v shellcheck >/dev/null 2>&1; then
    skip "shellcheck not installed"
  fi
  run shellcheck -s bash "$GATE10"
  [ "$status" -eq 0 ]
}

@test "the sourced contract is documented where the variables are set" {
  # The directive alone would be an unexplained suppression. The reason must be
  # discoverable at the assignment site.
  grep -q 'Consumed by the sourcing parent' "$GATE10"
  grep -q 'shellcheck disable=SC2034' "$GATE10"
}

@test "both flagged variables carry the directive" {
  local reason_line scanned_line
  reason_line=$(grep -n 'GATE_10_REASON=' "$GATE10" | head -1 | cut -d: -f1)
  scanned_line=$(grep -n 'GATE_10_SCANNED_FILES=' "$GATE10" | head -1 | cut -d: -f1)
  [ -n "$reason_line" ]
  [ -n "$scanned_line" ]
  # A disable directive two lines above the assignment applies to it.
  local before_reason before_scanned
  before_reason=$(sed -n "$((reason_line - 2)),$((reason_line))p" "$GATE10" | grep -c 'disable=SC2034' || true)
  before_scanned=$(sed -n "$((scanned_line - 2)),$((scanned_line))p" "$GATE10" | grep -c 'disable=SC2034' || true)
  [ "$before_reason" -ge 1 ]
  [ "$before_scanned" -ge 1 ]
}
