#!/usr/bin/env bats

# Issue #534 — Python gate speed-up.
#
# These tests pin the incremental (staged-only) Python type-check that the
# pre-commit `python)` case now runs through githooks/lib/python-incremental-
# typecheck.sh, plus the Go incremental golangci-lint and the ty opt-in in
# githooks/adapters/python.sh.
#
# The single most important lock: mypy's REAL exit code must survive. The old
# inline block did
#   mypy ... 2>&1 | head -20 | tail -10; MYPY_EXIT=$?
# which takes the PIPE STAGE's exit code as $?. In pre-commit (which has
# `set -o pipefail`) mypy's status does propagate, but outside a pipefail
# context (e.g. a subshell) the gate would silently pass on real type errors,
# and the `| head | tail` pattern is fragile and copy-paste hazardous. #534
# redirects to a temp file and takes mypy's own status — deterministic,
# pipefail-independent, and it keeps mypy's output intact (no SIGPIPE truncation).

HELPER="$BATS_TEST_DIRNAME/../lib/python-incremental-typecheck.sh"
PYTHON_ADAPTER="$BATS_TEST_DIRNAME/../adapters/python.sh"
PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"

# ============================================================================
# python_staged_py_files — extraction from mixed CHANGED_FILES
# ============================================================================

@test "#534 python_staged_py_files extracts only .py/.pyi from CHANGED_FILES" {
  source "$HELPER"
  export CHANGED_FILES=$'src/a.py\nscripts/b.pyi\nREADME.md\nsrc/c.ts\n.pyconfig\n.venv/x.py'
  run python_staged_py_files
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '^src/a.py$'
  echo "$output" | grep -q '^scripts/b.pyi$'
  echo "$output" | grep -qv '^README.md$'
  echo "$output" | grep -qv '^src/c.ts$'
  echo "$output" | grep -qv '^.pyconfig$'
  echo "$output" | grep -qv '^.venv/x.py$'
}

@test "#534 python_staged_py_files returns nothing for empty CHANGED_FILES" {
  source "$HELPER"
  export CHANGED_FILES=""
  run python_staged_py_files
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ============================================================================
# python_typecheck_incremental — exit code capture + scope + args
# ============================================================================

@test "#534 incremental mypy captures mypy's real exit code (not a pipe stage's)" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  # A mypy stub that exits 1 (type error) — must be surfaced as a BLOCK.
  printf '#!/usr/bin/env bash\necho "$@" >> "%s/mypy.args"\necho "a.py:1: error: incompatible type" >&2\nexit 1\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/stub:$PATH"
  run bash -c "source '$HELPER'; python_typecheck_incremental src/a.py"
  [ "$status" -eq 1 ]
  # mypy must be invoked with the incremental flags, not --follow-imports absent.
  grep -q -- '--follow-imports=silent' "$sandbox/mypy.args"
  grep -q -- '--ignore-missing-imports' "$sandbox/mypy.args"
  grep -q -- 'src/a.py' "$sandbox/mypy.args"
  rm -rf "$sandbox"
}

@test "#534 incremental mypy passes cleanly (exit 0) when mypy exits 0" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/stub:$PATH"
  run bash -c "source '$HELPER'; python_typecheck_incremental src/a.py"
  [ "$status" -eq 0 ]
  rm -rf "$sandbox"
}

@test "#534 incremental mypy SKIPs (exit 0) with no staged files" {
  source "$HELPER"
  run python_typecheck_incremental
  [ "$status" -eq 0 ]
}

@test "#534 incremental mypy SKIPs staged files outside declared scope" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src" "$sandbox/repo/tests"
  echo "x = 1" > "$sandbox/repo/tests/out.py"
  echo "src" > "$sandbox/repo/.xp-gate-mypy-scope"
  printf '#!/usr/bin/env bash\necho invoked >> "%s/mypy.invoked"\nexit 1\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/stub:$PATH"
  # tests/out.py is outside the declared src/ scope -> SKIP, mypy not invoked.
  run bash -c "source '$HELPER'; python_typecheck_incremental tests/out.py"
  [ "$status" -eq 0 ]
  [ ! -f "$sandbox/mypy.invoked" ]
  rm -rf "$sandbox"
}

# ============================================================================
# Go incremental golangci-lint (REQ-2a)
# ============================================================================

@test "#534 golangci-lint runs over staged .go only (no bare full-repo scan)" {
  # The pre-commit go branch must pass CHANGED_FILES-derived .go targets to
  # golangci-lint instead of bare `golangci-lint run` (whole repo).
  grep -q 'GO_FILES=$(echo "$CHANGED_FILES" | grep' "$PRE_COMMIT"
  grep -q 'golangci-lint run $GO_FILES' "$PRE_COMMIT"
  # The old full-repo bare invocation must be gone.
  ! grep -qE '^\s*golangci-lint run$' "$PRE_COMMIT"
}

# ============================================================================
# ty explicit opt-in (REQ-2b) — python.sh run_static_analysis
# ============================================================================

@test "#534 XP_GATE_TY=1 with ty present switches to ty check" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  printf '#!/usr/bin/env bash\necho "$@" >> "%s/ty.args"\nexit 0\n' "$sandbox" > "$sandbox/stub/ty"
  chmod +x "$sandbox/stub/ty"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/stub:$PATH"
  # @intent: explicit opt-in uses `ty check <target>`, mypy is NOT invoked.
  run bash -c "export XP_GATE_TY=1; source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  grep -q '^check$' "$sandbox/ty.args"
  grep -q '^src$' "$sandbox/ty.args"
  [ ! -f "$sandbox/mypy.args" ]
  rm -rf "$sandbox"
}

@test "#534 XP_GATE_TY=1 but ty missing -> SKIP (no BLOCK), mypy not required" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/repo/src"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  # Empty stub PATH: neither ty nor mypy present.
  mkdir -p "$sandbox/emptystub"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/emptystub:$PATH"
  # @intent: opt-in path must not require mypy (Delphi R1 Critical) and must not
  #   BLOCK on a missing ty — it returns 0 (SKIP).
  run bash -c "export XP_GATE_TY=1; source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'SKIPPING'
  rm -rf "$sandbox"
}

@test "#534 default (no XP_GATE_TY) still requires mypy (authoritative)" {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/stub" "$sandbox/repo/src"
  echo "x = 1" > "$sandbox/repo/src/a.py"
  cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"
  printf '#!/usr/bin/env bash\n echo "$@" >> "%s/mypy.args"\nexit 0\n' "$sandbox" > "$sandbox/stub/mypy"
  chmod +x "$sandbox/stub/mypy"
  cd "$sandbox/repo" || return 1
  export PATH="$sandbox/stub:$PATH"
  run bash -c "source '$sandbox/githooks/adapters/python.sh'; run_static_analysis"
  [ "$status" -eq 0 ]
  grep -q '^src$' "$sandbox/mypy.args"
  rm -rf "$sandbox"
}

# ============================================================================
# Anti-bare-ty guard (REQ-2b) — mirrors the #501/#513 anti-bare-mypy protection
# ============================================================================

@test "#534 python.sh must never emit a bare ty check (no explicit target)" {
  # A bare `ty check` / `ty check .` recurses the whole tree, the ty twin of the
  # anti `mypy .` guard (#501/#513). Targets must always be explicit.
  run grep -nE 'ty check *\.?$' "$PYTHON_ADAPTER"
  [ "$status" -eq 1 ]
  run grep -nE 'ty check *$' "$PYTHON_ADAPTER"
  [ "$status" -eq 1 ]
}
