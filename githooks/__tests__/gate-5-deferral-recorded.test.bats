#!/usr/bin/env bats
# @test REQ-GATE5-DEFERRAL-RECORDED
#
# @intent A gate observed something and wrote it to a variable nobody read.
#
# Gate 5 has three ways a language's tests may end up not being run by this gate:
#
#   1. the adapter DELEGATES them to CI      -> printed, recorded in GATE_5_DETAIL,
#                                               appended to DELEGATED_LANGS
#   2. the coverage run INCLUDES them        -> printed, then `TESTS_DEFERRED=true`
#   3. the adapter has a run_tests()         -> run right here
#
# Case 2 recorded the fact in a variable that no file reads. Measured 2026-11-20:
#
#     grep -rn TESTS_DEFERRED --include='*.sh' --include='*.ts' --include='*.cjs' .
#     githooks/gate-entries/gate-5-entry.sh:980:          TESTS_DEFERRED=true
#     src/npm-package/hooks/gate-entries/gate-5-entry.sh:980:  TESTS_DEFERRED=true
#
# Two writes, zero reads -- not in pre-commit, the driver, githooks/lib/ or any
# other gate body. The consequence is not a crash, which is why it survived: the
# console said "deferring test execution to a single pass", the audit journal said
# nothing at all about why that language's tests did not run, and a reader
# comparing two languages in one commit could not tell a deferral from a run.
#
# The note that stood above the variable in the file already diagnosed it and said
# deleting it was safe and belonged in its own commit. Deleting it outright would
# have dropped the fact, so the fact moved to GATE_5_DETAIL -- the field that
# already carries case 1 and which reaches the journal through record_gate_audit.
#
# Deliberately NOT appended to DELEGATED_LANGS: that variable is reported further
# down as "tests delegated to CI", and a coverage-run deferral is not a CI
# delegation. Reusing it would relabel this case as the other one.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

# @covers the dead variable is gone
@test "TESTS_DEFERRED is not assigned anywhere in the source tree" {
  # Mentions in the explanatory comment are fine; an assignment is not.
  #
  # Scoped to the tracked source tree. `.git/hooks/` holds an INSTALLED copy of
  # these files -- it is a deployed artefact of whatever was last synced, not a
  # piece of the source, and asserting against it would make this test fail for
  # every developer whose hooks predate the sync.
  run grep -rnE '^[[:space:]]*TESTS_DEFERRED=' "$REPO_ROOT/githooks" "$REPO_ROOT/scripts" "$REPO_ROOT/src" 2>/dev/null
  [ "$status" -eq 1 ]
}

# @covers the fact survived the deletion
@test "the coverage-run deferral is recorded in GATE_5_DETAIL" {
  run grep -c 'tests deferred to the coverage run' "$GATE"
  [ "$output" = "1" ]
}

# @covers the recorded field is one that actually reaches the journal
@test "GATE_5_DETAIL reaches record_gate_audit" {
  run grep -c 'record_gate_audit "gate-5" "tests-coverage".*GATE_5_DETAIL' "$GATE"
  [ "$output" = "1" ]
}

# @covers the deferral is not mislabelled as a CI delegation
@test "the deferral branch does not append to DELEGATED_LANGS" {
  # The sentence "tests delegated to CI for: <langs>" must not end up listing a
  # language whose tests were merely folded into the coverage pass.
  #
  # The branch is delimited by line numbers rather than by an awk range, because
  # the body itself contains `else`-looking text and a range that stops at the
  # first one silently measures nothing. Both endpoints are asserted to exist.
  local start end
  start=$(grep -n 'elif adapter_declares_coverage_runs_tests; then' "$GATE" | cut -d: -f1)
  [ -n "$start" ]
  end=$(awk -v s="$start" 'NR > s && /^        else$/ { print NR; exit }' "$GATE")
  [ -n "$end" ]
  [ "$end" -gt "$start" ]

  local branch
  branch=$(sed -n "${start},${end}p" "$GATE")

  # The branch records the fact ...
  echo "$branch" | grep -q 'GATE_5_DETAIL='
  # ... and does not touch DELEGATED_LANGS.
  ! echo "$branch" | grep -q 'DELEGATED_LANGS='
}

# @covers the gate still parses and the branch is reachable
@test "the gate body parses and declares the coverage-runs-tests branch" {
  run bash -n "$GATE"
  [ "$status" -eq 0 ]
  run grep -c 'elif adapter_declares_coverage_runs_tests; then' "$GATE"
  [ "$output" = "1" ]
}
