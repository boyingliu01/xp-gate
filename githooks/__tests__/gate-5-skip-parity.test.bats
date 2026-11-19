#!/usr/bin/env bats
#
# @test REQ-GATE5-SKIP-PARITY A skipped test run must be recorded as a skip for
#       EVERY language, not only for the one whose wording was hardcoded
# @intent Gate 5 decides whether an exit-0 test run means "the suite passed" or
#         "nothing ran" by grepping the adapter's output for a phrase:
#
#             if [ "$TESTS_EXIT_CODE" -eq 0 ] &&
#                printf '%s' "$TESTS_OUTPUT" | grep -q "No test runner installed locally"
#             then TESTS_SKIPPED=true
#             fi
#
#         That is the typescript adapter's sentence. Every other adapter says
#         something else, so every other adapter's skip was recorded as a pass:
#
#             shell       "bats not available, skipping shell test suite"   -> PASSED - Unit tests passed.
#             php         "No phpunit.xml(.dist) found -- not discoverable" -> PASSED
#             powershell  "No Pester tests found"                          -> PASSED
#             swift       "No Swift test framework detected"               -> PASSED
#             objectivec  "No Objective-C test framework detected"         -> PASSED
#
#         Measured 2026-11-19 on a shell fixture with a .bats suite whose only
#         test is `[ 1 -eq 2 ]`, on a machine where bats IS installed (in
#         node_modules/, just not on the hook's PATH):
#
#             Running tests...
#             bats not available, skipping shell test suite (install: npm i -D bats)
#             PASSED - Unit tests passed.
#
#         A suite that was never executed was reported as a passing unit test
#         run -- the defect family both AGENTS.md files name, and the reason the
#         `xp-gate` journal cannot be trusted for these languages.
#
#         Fix: the adapters emit a machine-readable marker when they skip
#         (`XP_GATE_TESTS_SKIPPED`), and the gate reads the marker instead of
#         matching prose. A list of per-language sentences can only ever contain
#         what someone remembered -- the same reasoning that removed hand-written
#         language lists everywhere else in this codebase.
#
# @covers AC-GATE5-SKIP-PARITY-01  a generic skip is detected, not just TS's
# @covers AC-GATE5-SKIP-PARITY-02  a real pass is still a pass
# @covers AC-GATE5-SKIP-PARITY-03  a real failure is still a failure
# @covers AC-GATE5-SKIP-PARITY-04  the shell adapter emits the marker
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

require_helper() {
  grep -q '^_gate5_test_run_skipped()' "$GATE" || {
    echo "_gate5_test_run_skipped is not defined: skipped runs are still matched by prose"
    false
  }
}

load_gate() {
  GATE_DIR="$REPO_ROOT/githooks"
  export GATE_DIR
  # shellcheck source=/dev/null
  . "$GATE"
}

@test "AC-GATE5-SKIP-PARITY-01: the marker is recognised regardless of the adapter's prose" {
  load_gate
  require_helper

  # The contract is the marker, not the sentence. Each adapter keeps its own
  # human-readable wording -- which is good, it names the actual tool -- and
  # says XP_GATE_TESTS_SKIPPED once so the gate does not have to parse prose.
  #
  # An earlier version of this test asserted that five particular SENTENCES were
  # recognised without the marker. That would have re-created the defect it was
  # written to catch: a list of wordings that can only contain what someone
  # remembered. What the gate needs is one signal, and each adapter needs to send
  # it; prose recognition is legacy compatibility for adapters not yet updated.
  local msg
  for msg in \
    "bats not available, skipping shell test suite (install: npm i -D bats)
XP_GATE_TESTS_SKIPPED" \
    "No phpunit.xml(.dist) found -- test suite not discoverable
XP_GATE_TESTS_SKIPPED" \
    "No Pester tests found
XP_GATE_TESTS_SKIPPED" \
    "No Swift test framework detected
XP_GATE_TESTS_SKIPPED" \
    "No Objective-C test framework detected
XP_GATE_TESTS_SKIPPED"
  do
    run _gate5_test_run_skipped 0 "$msg"
    [ "$status" -eq 0 ] || {
      echo "the marker was not recognised alongside: $msg"
      false
    }
  done
}

@test "AC-GATE5-SKIP-PARITY-01b: the legacy TypeScript sentence still works" {
  # Deprecated path, kept deliberately: an adapter that has not been updated to
  # emit the marker must still land on the right side, or upgrading the gate
  # silently re-breaks TypeScript projects.
  load_gate
  require_helper

  run _gate5_test_run_skipped 0 "SKIP - No test runner installed locally (node_modules/.bin has no vitest or jest)"
  [ "$status" -eq 0 ] || {
    echo "the pre-existing TypeScript skip wording no longer recognised"
    false
  }
}

@test "AC-GATE5-SKIP-PARITY-02: a genuine pass is not misread as a skip" {
  # The anti-vacuity direction. If every exit-0 run counted as a skip, nothing
  # would ever be verified again -- the opposite failure, and the easier one to
  # introduce while fixing this.
  load_gate
  require_helper

  run _gate5_test_run_skipped 0 "Tests  772 passed (772)
Test Files  75 passed (75)"
  [ "$status" -ne 0 ] || {
    echo "a passing suite was classified as a skip"
    false
  }
}

@test "AC-GATE5-SKIP-PARITY-03: a failure is never a skip, whatever the text" {
  # A non-zero exit outranks any skip wording: an adapter that both printed a
  # skip line and exited non-zero has found something.
  load_gate
  require_helper

  run _gate5_test_run_skipped 1 "bats not available, skipping shell test suite"
  [ "$status" -ne 0 ] || {
    echo "a non-zero exit was excused as a skip"
    false
  }
}

@test "AC-GATE5-SKIP-PARITY-04: the shell adapter emits the machine-readable skip marker" {
  # The gate can only read a marker the adapter writes. Without this the fix is
  # a predicate nothing feeds.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/tests"
  printf '#!/bin/sh\necho hi\n' > "$work/run.sh"
  cat > "$work/tests/sample.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "deliberately failing" {
  [ 1 -eq 2 ]
}
SUITE
  # No bats reachable: PATH stripped to a directory with only the basics the
  # adapter needs, and no node_modules anywhere above the fixture.
  local out
  out=$( cd "$work" && PATH="/usr/bin:/bin" bash -c '
    source "'"$REPO_ROOT"'/githooks/adapter-common.sh" 2>/dev/null
    source "'"$REPO_ROOT"'/githooks/adapters/shell.sh" 2>/dev/null
    run_tests' 2>&1 )

  printf '%s' "$out" | grep -q 'XP_GATE_TESTS_SKIPPED' || {
    echo "the shell adapter did not emit XP_GATE_TESTS_SKIPPED"
    echo "output was: $out"
    rm -rf "$work"
    false
  }
  rm -rf "$work"
}
