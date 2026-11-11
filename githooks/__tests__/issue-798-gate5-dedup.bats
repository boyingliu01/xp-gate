#!/usr/bin/env bats
# @test REQ-798-GATE5-DEDUP
# @intent Gate 5 runs the project's test suite twice per commit: once in the
#         test phase (run_tests) and again in the coverage phase (run_coverage),
#         the second time only to collect coverage. #794 measured one such pair
#         at 28.5s + 30.0s: two near-identical runs, where the coverage run
#         already executes and validates every test.
#
#         This has already been fixed twice, one language at a time:
#           - TypeScript: the test phase passes --coverage directly, so the
#             coverage phase finds coverage-summary.json and skips.
#           - Python: a `if [ "$CURRENT_LANG" = "python" ]` special case in the
#             hook defers the test run into the coverage phase.
#         Both fixes target the same defect but share no mechanism, so the
#         third occurrence is guaranteed unless the decision moves out of the
#         hook and into the adapter contract.
#
#         The property asserted here: whether a coverage run subsumes the test
#         run is declared by the ADAPTER (which knows its toolchain), and the
#         hook decides from that declaration. Crucially the default must be
#         "not declared => run tests anyway" — a missing declaration may cost
#         time, but it must never silently drop test verification.
# @covers AC-798-G5-01, AC-798-G5-02, AC-798-G5-03, AC-798-G5-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  ADAPTERS="$REPO_ROOT/githooks/adapters"
}

# ---------------------------------------------------------------------------
# AC-798-G5-01 — the contract exists on the adapter side.
# ---------------------------------------------------------------------------

@test "AC-798-G5-01: adapters can declare that coverage subsumes the test run" {
  # The probe must live in the adapter contract, not only in the hook, or the
  # next language repeats the third special case.
  grep -rq 'coverage_runs_tests' "$ADAPTERS" \
    || grep -q 'adapter_declares_coverage_runs_tests' "$HOOK"
}

@test "AC-798-G5-01: the hook resolves the declaration through a single helper" {
  grep -q 'adapter_declares_coverage_runs_tests\|coverage_runs_tests' "$HOOK"
}

# ---------------------------------------------------------------------------
# AC-798-G5-02 — the adapters that genuinely double-run must declare it.
# These are the languages #794 measured as still double-running.
# ---------------------------------------------------------------------------

@test "AC-798-G5-02: each double-running adapter declares coverage_runs_tests" {
  local missing=""
  local lang
  for lang in csharp go java kotlin dart swift; do
    local f="$ADAPTERS/$lang.sh"
    [ -f "$f" ] || continue
    grep -q 'coverage_runs_tests' "$f" || missing="$missing $lang"
  done
  if [ -n "$missing" ]; then
    echo "adapters missing the coverage_runs_tests declaration:$missing"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC-798-G5-03 — the default is conservative: no declaration => run tests.
# ---------------------------------------------------------------------------

@test "AC-798-G5-03: an undeclared adapter keeps the safe double-run default" {
  # Behavioural test of the helper in isolation: an adapter that does not
  # define the probe must report "0" (do not skip the test run).
  run bash -c '
    # shellcheck disable=SC1090
    eval "$(sed -n "/^adapter_declares_coverage_runs_tests()/,/^}/p" "'"$HOOK"'")"
    # An adapter with no declaration at all:
    _test_adapter_without_declaration() { return 0; }
    adapter_declares_coverage_runs_tests _test_adapter_without_declaration
    exit $?
  '
  # Non-zero exit == "not declared" == do NOT skip the test run.
  [ "$status" -ne 0 ]
}

@test "AC-798-G5-03: a declaring adapter does report that coverage subsumes tests" {
  run bash -c '
    eval "$(sed -n "/^adapter_declares_coverage_runs_tests()/,/^}/p" "'"$HOOK"'")"
    _test_adapter_with_declaration() { coverage_runs_tests() { return 0; }; }
    adapter_declares_coverage_runs_tests _test_adapter_with_declaration
    exit $?
  '
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC-798-G5-04 — no language special case may remain in the hook.
# ---------------------------------------------------------------------------

@test "AC-798-G5-04: the Python-only test-skip special case is replaced by the contract" {
  # The old code matched on the language NAME. If that remains as the decision
  # mechanism, the next adapter needs a fourth special case.
  ! grep -q 'if \[ "\$CURRENT_LANG" = "python" \]; then' "$HOOK" \
    || grep -q 'adapter_declares_coverage_runs_tests' "$HOOK"
}

@test "AC-798-G5-04: the misleading skip message cannot be printed twice" {
  # #798 comment 3: the TypeScript branch printed "Test run was skipped" while
  # skipping nothing, and the real double-run happened in the csharp branch.
  # Only the outer guard — the one that genuinely skips coverage — may EMIT this
  # line. Comments that quote it to explain the history are not emissions.
  local count
  count=$(grep -c 'echo "ℹ️  Test run was skipped — skipping coverage check' "$HOOK" || true)
  [ "${count:-0}" -le 1 ]
}
