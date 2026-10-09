#!/usr/bin/env bats

# Locks the machine-side adapter fixes that landed via issue #501.
#
# These tests pin the *scope* semantics of two adapters so the pre-#501
# behavior cannot silently return:
#
#   1. python.sh must typecheck the repo-*declared* surface, never a fixed
#      layout guess: `.xp-gate-mypy-scope` wins; otherwise `src/`/`scripts/`
#      run only when present, and a repo with neither must SKIP (exit 0,
#      mypy not invoked) instead of false-BLOCKing every .py commit (#513).
#      It must also NEVER regress to a bare `mypy .`, which recurses into
#      undeclared one-off scripts and tests/ (87 false errors observed) and
#      blocks every commit — including docs-only changes.
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

@test "python.sh keeps src/ and scripts/ in the default scope set (#501)" {
  # Post-#513 the invocation may be array-guarded, but both dirs must remain
  # the declared default targets (existence-guarded below).
  grep -q 'src' "$PYTHON_ADAPTER"
  grep -q 'scripts' "$PYTHON_ADAPTER"
}

@test "python.sh existence-guards every default mypy target (#513)" {
  grep -q 'src ]' "$PYTHON_ADAPTER"
  grep -q 'scripts ]' "$PYTHON_ADAPTER"
}

@test "python.sh honors the project-level .xp-gate-mypy-scope declaration (#513)" {
  grep -q '.xp-gate-mypy-scope' "$PYTHON_ADAPTER"
}

@test "python.sh skips (exit 0, mypy not invoked) when no declared dirs exist (#513)" {
  sandbox="$(mktemp -d)"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  mkdir -p "$sandbox/stub"
  printf '#!/usr/bin/env bash\necho invoked > "%s/mypy.invoked"\nexit 0\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox" || return 1
  # @intent: a repo with neither src/ nor scripts/ (e.g. skill-cert: engine/ layout)
  #   must not be false-BLOCKed (#513). @covers scope-degradation
  run bash -c "PATH='$sandbox/stub:\$PATH'; source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  [ ! -f "$sandbox/mypy.invoked" ]
  rm -rf "$sandbox"
}

@test "python.sh runs guarded mypy over existing dirs only (#513)" {
  sandbox="$(mktemp -d)"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src" "$sandbox/repo/scripts"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  printf '#!/usr/bin/env bash\necho "$@" >> "%s/mypy.args"\nexit 0\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  # @intent: default探测 keeps CI-aligned surface when the dirs exist.
  # @covers scope-degradation
  run bash -c "PATH='$sandbox/stub:\$PATH'; source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  grep -q 'src' "$sandbox/mypy.args"
  grep -q 'scripts' "$sandbox/mypy.args"
  rm -rf "$sandbox"
}

@test "python.sh .xp-gate-mypy-scope overrides the default dir probing (#513)" {
  sandbox="$(mktemp -d)"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src" "$sandbox/repo/engine"
  printf 'engine\n' > "$sandbox/repo/.xp-gate-mypy-scope"
  printf '#!/usr/bin/env bash\necho "$@" >> "%s/mypy.args"\nexit 0\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  # @intent: repo-declared scope is authoritative; src/ must then not be scanned.
  # @covers scope-degradation
  run bash -c "PATH='$sandbox/stub:\$PATH'; source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  grep -q 'engine' "$sandbox/mypy.args"
  run grep -q 'src' "$sandbox/mypy.args"
  [ "$status" -eq 1 ]
  rm -rf "$sandbox"
}

@test "npm mirror of python.sh is byte-identical to githooks source (#513)" {
  repo_root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  diff "$repo_root/githooks/adapters/python.sh" "$repo_root/src/npm-package/adapters/python.sh"
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
