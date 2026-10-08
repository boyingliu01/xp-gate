#!/bin/bash
# Gate 5 exit-code judgement for vitest runs, shared by every pre-commit branch
# that invokes vitest. Sourced by githooks/pre-commit; kept in its own file so
# the contract is unit-testable without executing the hook
# (githooks/__tests__/gate-5-runner-error.test.bats, gate-5-partial-threshold.test.bats).

# The one condition every excuse below shares: a real failure always wins.
#
# Kept as a single expression because a marker added for one exit class and
# forgotten in another re-opens the false BLOCK the excuse exists to close.
has_real_failure_marker() {
  printf '%s' "$1" | grep -qE 'Tests +[0-9]+ failed|FAIL |AssertionError'
}

# Detect a vitest *runner infrastructure* failure as opposed to a real test
# failure. On Windows, vitest 1.6.x can exit non-zero while reporting zero failed
# tests, because its temp/ssr module cache hits EPERM (#454). Treating that as
# "Tests FAILED" sends developers chasing a bug that does not exist.
#
# The two patterns below are vitest's DEFAULT-REPORTER shape for the assumed major
# (declared as `vitest: ^1.6.1` in package.json). They are not universal: a reporter
# change or a vitest 2 upgrade could stop emitting "Unhandled Error", and the
# detection would silently revert to false BLOCKs. That assumption is therefore
# asserted, not assumed -- scripts/__tests__/gate-5-runner-error.test.ts
# (AC-454-07) fails the moment the declared version leaves the pinned range, which
# is the signal to re-verify these patterns against the new output shape.
#
# Returns 0 (true) only when both hold:
#   - the output mentions "Unhandled Error" (vitest's runner-level failure), AND
#   - no real test failure marker is present.
is_runner_infrastructure_error() {
  local _out="$1"
  [ -n "$_out" ] || return 1
  printf '%s' "$_out" | grep -qE 'Unhandled Error' || return 1
  has_real_failure_marker "$_out" && return 1
  return 0
}

# Detect the partial-run coverage-threshold exit (#473).
#
# Gate 5's "changed test files" and "related test files" branches run
# `npx vitest run --coverage <a few files>`. vitest applies the project's GLOBAL
# coverage thresholds to whatever subset it ran, so a subset in which every test
# passed still exits 1 with
#   ERROR: Coverage for lines (10.87%) does not meet global threshold (80%)
# Reading that as "Tests FAILED" false-blocked every partial run on any machine
# with node installed.
#
# Scoped to PARTIAL_TEST_RUN=true on purpose: a full-suite threshold miss is a
# genuine coverage failure and must still block.
#
# Returns 0 only when all three hold:
#   - this was a partial run,
#   - the output carries the threshold complaint, AND
#   - no real test failure marker is present.
is_partial_threshold_only_exit() {
  local _out="$1"
  [ "${PARTIAL_TEST_RUN:-false}" = "true" ] || return 1
  [ -n "$_out" ] || return 1
  printf '%s' "$_out" | grep -qE 'does not meet global threshold' || return 1
  # A real failure must still block.
  has_real_failure_marker "$_out" && return 1
  return 0
}

# Detect the third non-failure exit: vitest found nothing to run at all (#498).
#
# A TypeScript project with no test files, and a partial run whose every target
# falls outside the suite it is being run from, both make vitest print
#   No test files found, exiting with code 1
# and exit non-zero. No test failed; none ran. Reporting that as "Tests FAILED"
# blocked every commit in such a repo, including the fixtures that were written
# to prove Gate 5a blocks a *missing test* (githooks/__tests__/gate-5a-block.test.bats
# died in setup, before any assertion of its own was reached).
#
# Matched as vitest's whole sentence including its exit-code clause rather than
# as the bare phrase: a test that logs the phrase from its own title describes a
# run that did collect files, and must not be excused.
#
# Returns 0 only when both hold:
#   - the output carries vitest's no-test-files sentence, AND
#   - no real test failure marker is present.
is_no_test_files_found() {
  local _out="$1"
  [ -n "$_out" ] || return 1
  printf '%s' "$_out" | grep -qE 'No test files found, exiting with code [0-9]+' || return 1
  has_real_failure_marker "$_out" && return 1
  return 0
}

# Judge a non-zero vitest exit and report the outcome (Issues #454, #473, #498).
#
# Before this helper existed, each Gate 5 branch carried its own
# `echo "❌ BLOCKED - Tests FAILED"`, and only ONE of them consulted
# is_runner_infrastructure_error. The others therefore reported a Windows
# EPERM-on-temp-cache runner error as a genuine test failure, sending
# developers hunting for a bug that did not exist. Routing every vitest branch
# through one helper makes that class of drift structurally impossible.
#
# Usage: handle_test_failure <output> <site-context>
#   $1 = captured test output (passed EXPLICITLY -- never read a global, so a
#        branch that forgets to set one fails loudly instead of silently
#        treating empty output as "no runner error")
#   $2 = short context label used in the BLOCK message; may be empty
# Returns 0 when the run should be treated as SKIPPED (a runner infrastructure
# error, a partial run that only missed the global coverage threshold, or a run
# that matched no test files at all), 1 when it must BLOCK. Callers use
# `|| exit 1`.
#
# NOTE: only vitest branches may call this. The generic `run_tests` fallbacks
# (non-TS adapters) are deliberately left unguarded: their output format is not
# guaranteed to look like vitest's, so guarding them could let a real failure
# through.
handle_test_failure() {
  local _out="$1"
  local _ctx="$2"
  if is_runner_infrastructure_error "$_out"; then
    echo ""
    echo "⏭️  SKIPPED - vitest runner infrastructure error (no test failed)"
    echo "    Detected: Unhandled Errors with 0 failed tests."
    echo "    Known Windows issue: EPERM on vitest temp/ssr cache (#454)."
    echo "    Workaround: npx vitest run --no-file-parallelism <targets>"
    TESTS_SKIPPED=true
    TESTS_EXIT_CODE=0
    return 0
  fi
  if is_partial_threshold_only_exit "$_out"; then
    echo ""
    echo "⏭️  SKIPPED - coverage threshold judgement for this partial run (no test failed)"
    echo "    Detected: 'does not meet global threshold' with 0 failed tests."
    echo "    vitest scores the whole project against a subset of tests (#473)."
    echo "    Full-suite coverage is still enforced by the full run and by CI."
    TESTS_EXIT_CODE=0
    # TESTS_SKIPPED is deliberately NOT set here, unlike the runner-error path:
    # this run produced real coverage data, and the coverage section downstream
    # carries the new-file coverage block, which must stay live.
    return 0
  fi
  if is_no_test_files_found "$_out"; then
    echo ""
    echo "⏭️  SKIPPED - no test files matched, so Gate 5 ran zero tests"
    echo "    Detected: 'No test files found, exiting with code N' with 0 failed tests."
    echo "    This is not a pass: nothing executed (#498)."
    echo "    Test presence is enforced by Gate 5a and by CI, not by this exit."
    TESTS_SKIPPED=true
    TESTS_EXIT_CODE=0
    return 0
  fi
  echo ""
  echo "❌ BLOCKED - Tests FAILED${_ctx:+ in ${_ctx}}"
  return 1
}
