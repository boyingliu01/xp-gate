#!/usr/bin/env bats

# Locks the machine-side adapter fixes that landed via issue #501.
#
# These tests pin the *scope* semantics of two adapters so the pre-#501
# behavior cannot silently return:
#
#   1. python.sh must typecheck the same surface as CI's type job
#      (`mypy src/` + `mypy scripts/`) and must NEVER regress to a bare
#      `mypy .`, which recurses into undeclared one-off scripts and tests/
#      (87 false errors observed) and blocks every commit — including
#      docs-only changes.
#
#   2. powershell.sh must honor the project-level coverage exclusion file
#      `.xp-gate-powershell-coverage-ignore` and must use the Pester 5
#      configuration object (`New-PesterConfiguration`); the Pester 4
#      `-CodeCoverage` parameter set fails outright on Pester 5 and used to
#      produce a silent zero-coverage result with a fake WARNING + exit 0.

PYTHON_ADAPTER="$BATS_TEST_DIRNAME/../adapters/python.sh"
POWERSHELL_ADAPTER="$BATS_TEST_DIRNAME/../adapters/powershell.sh"

# ============================================================================
# python.sh — mypy scope must match the CI type job
# ============================================================================

@test "python.sh declares the CI-aligned mypy scope (mypy src/ + mypy scripts/)" {
  grep -q 'mypy src/' "$PYTHON_ADAPTER"
  grep -q 'mypy scripts/' "$PYTHON_ADAPTER"
}

@test "python.sh must not contain a bare 'mypy .' recursion (#501)" {
  # A bare `mypy .` recurses into undeclared files and permanently reddens the
  # hook. Allow `mypy src/`, `mypy scripts/`, or commented-out mentions only.
  # [[:space:]] not \s: the latter is a GNU grep extension absent on BSD/macOS.
  run bash -c "grep -nE '^[[:space:]]*mypy \.' '$PYTHON_ADAPTER'"
  [ "$status" -eq 1 ]
}

@test "python.sh excludes e2e-marked pytest runs in pre-commit context" {
  grep -q -- '-m "not e2e"' "$PYTHON_ADAPTER"
}

@test "python.sh does not hardcode a --cov-fail-under threshold" {
  # The threshold must come from pyproject.toml [tool.coverage.report]
  # fail_under (single source of truth); a duplicated flag here drifts.
  # Commented-out historical mentions are allowed; live code is not.
  run bash -c "grep -n -- '--cov-fail-under' '$PYTHON_ADAPTER' | grep -vE '^[0-9]+:[[:space:]]*#'"
  [ "$status" -eq 1 ]
}

@test "python.sh falls back to 'python3 -m mutmut' when the mutmut binary is absent" {
  grep -q 'python3 -m mutmut' "$PYTHON_ADAPTER"
}

# ============================================================================
# powershell.sh — coverage exclusions + Pester 5 configuration object
# ============================================================================

@test "powershell.sh honors the project-level .xp-gate-powershell-coverage-ignore file (#501)" {
  grep -q '\.xp-gate-powershell-coverage-ignore' "$POWERSHELL_ADAPTER"
}

@test "powershell.sh documents the ignore-file convention inline (comments, not just code)" {
  grep -q 'Format: one glob per line' "$POWERSHELL_ADAPTER"
}

@test "powershell.sh uses the Pester 5 New-PesterConfiguration object" {
  grep -q 'New-PesterConfiguration' "$POWERSHELL_ADAPTER"
  # The deprecated Pester 4 coverage parameter set must not return: coverage
  # must flow through the modern configuration object only. (A plain
  # `Invoke-Pester -Path` for running tests without coverage is legitimate.)
  run bash -c "grep -n 'Invoke-Pester .*-CodeCoverage' '$POWERSHELL_ADAPTER'"
  [ "$status" -eq 1 ]
}

@test "powershell.sh does not fake a coverage threshold with WARNING + exit 0" {
  # The pre-#501 copy printed "WARNING: Coverage ... below 80%" and exited 0,
  # which reported nothing and blocked nothing — a no-op gate.
  run bash -c "grep -n 'WARNING: Coverage' '$POWERSHELL_ADAPTER'"
  [ "$status" -eq 1 ]
}

@test "powershell.sh still parses: bash -n accepts both adapters" {
  bash -n "$PYTHON_ADAPTER"
  bash -n "$POWERSHELL_ADAPTER"
}
