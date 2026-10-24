#!/bin/bash
# Gate 5's Python coverage parsing and threshold verdict (#523).
#
# Sourced by githooks/pre-commit; kept in its own file so the contract is
# unit-testable without executing the hook
# (githooks/__tests__/issue-523-python-coverage-parse.test.bats).
#
# The defect this file exists for: `coverage report --format=total` prints a
# BARE number ("97"), but the hook piped it through `grep -o '[0-9]*%'` — a
# pattern that requires a literal percent sign — so COVERAGE_PERCENT was always
# empty and the 80% threshold branch never executed. The gate answered "Could
# not determine" forever: a silent no-op, not a verdict.

# Parse the raw output of `coverage report --format=total` (stdin) and echo the
# integer total percentage — or nothing when the input carries no number.
#
# coverage.py 7.x --format=total prints a bare number; other tools (and older
# forms) append a percent sign. Only a line that IS a bare number (optionally
# %-suffixed) is accepted — a line that merely CONTAINS a number ("WARNING: 2
# files skipped") must not be mistaken for the total, so the whole line is
# matched, not the first token. A decimal part is truncated (floor — the
# conservative direction for a threshold gate, the same convention as the Java
# path's ${VAR%.*}). Inputs without any bare-number line (empty, "No data to
# report.", warnings) produce NO output so the caller takes its
# cannot-determine path: a wrong number is worse than none.
parse_coverage_total() {
  awk '
    {
      line = $0
      sub(/%$/, "", line)
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line ~ /^[0-9]+(\.[0-9]+)?$/) {
        sub(/\.[0-9]+$/, "", line)
        print line
        exit
      }
    }
  '
}

# Gate 5 Stage 2 Python coverage enforcement — the hook's python case body,
# extracted so the mock-PATH test exercises the real control flow. Echoes the
# verdict lines and returns 1 on BLOCK (the caller turns that into `exit 1`).
#
# COVERAGE_PERCENT is deliberately NOT declared local: the hook's quality
# report reads it after the Stage-2 loop (last writer wins across languages),
# exactly as the inline branch did.
enforce_python_coverage() {
  # Critical-1 (#399): when the test run was skipped (PY_STRATEGY=skip, set in
  # pre-commit before this Stage-2 function), refuse to consume a stale
  # .coverage left by an earlier subset run — its low % is meaningless for a
  # commit that changed no Python and must not BLOCK a docs-only change. This
  # mirrors the TS branch's TESTS_SKIPPED guard.
  if [ "${PY_TEST_SKIPPED:-false}" = "true" ]; then
    echo "ℹ️  Test run was skipped — skipping Python coverage check."
    return 0
  fi

  if ! command -v coverage &> /dev/null; then
    echo "⚠️  coverage.py not available, cannot enforce Python coverage threshold."
    return 0
  fi

  COVERAGE_PERCENT=""
  if [ -f ".coverage" ]; then
    COVERAGE_PERCENT=$(coverage report --format=total 2>/dev/null | parse_coverage_total) || true
  fi
  if [ -z "$COVERAGE_PERCENT" ] && [ -f "coverage/.coverage" ]; then
    COVERAGE_PERCENT=$(coverage report --format=total -i coverage 2>/dev/null | parse_coverage_total) || true
  fi

  if [ -n "$COVERAGE_PERCENT" ]; then
    if [ "$COVERAGE_PERCENT" -lt "${COVERAGE_THRESHOLD:-80}" ]; then
      # #399: a subset run (smart test selection) measures only the tested
      # files, so its global total is meaningless as a verdict — the full
      # suite may well be >=80% even when the subset is not. Warn exactly as
      # the TypeScript branch does (#286) instead of blocking. Full runs keep
      # the hard BLOCK below.
      if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
        echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
        echo "    Run the full suite for a real Python coverage check."
        return 0
      fi
      echo "❌ BLOCKED - Python coverage ${COVERAGE_PERCENT}% below ${COVERAGE_THRESHOLD:-80}% threshold"
      return 1
    fi
    echo "Python coverage: ${COVERAGE_PERCENT}% ✅ (≥ ${COVERAGE_THRESHOLD:-80}%)"
    return 0
  fi

  # #570: reaching here means the gate produced NO measurement. That is a FAILED
  # answer to "is coverage at or above the floor?", not a lenient one — the gate
  # exists to answer that question and answered nothing. Warning and returning 0
  # made the gate fail-open: deleting .coverage (or a pytest run that died before
  # writing it) disabled the coverage check while the summary still looked clean.
  #
  # The one legitimate exception is a subset run: nothing was measured because
  # only part of the suite was run, so there is no total to compare.
  if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
    echo "⚠️  Could not determine Python coverage percentage (subset test run) — not blocking."
    return 0
  fi
  echo "❌ BLOCKED - Could not determine Python coverage percentage."
  echo "   No .coverage / coverage report was produced, so the ${COVERAGE_THRESHOLD:-80}% floor"
  echo "   cannot be verified. Run the suite with coverage (pytest --cov) and commit again."
  return 1
}
