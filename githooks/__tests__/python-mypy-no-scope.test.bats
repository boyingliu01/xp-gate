#!/usr/bin/env bats
#
# @test REQ-PY-MYPY-NOSCOPE a Python file that fails mypy is blocked with no declared scope
# @intent The incremental type-check resolves a SCOPE first: .xp-gate-mypy-scope if
#         present, else the src/ and scripts/ directories. Both are declarations of
#         WHERE to look, and narrowing them exists so a large repository's
#         pre-commit stays fast and free of unrelated noise.
#
#         When neither exists -- an ordinary small Python project with its modules at
#         the repository root -- SCOPE_DIRS was empty, the filtering loop never ran,
#         TYPECHECK_FILES stayed empty, and the function returned 0.
#
#         Gate 1 reads 0 as a clean type check and prints:
#
#             PASSED - mypy type checking.
#
#         Measured 2026-11-19, language matrix, python fixture:
#
#             a.py : def f() -> int: return "not an int"
#             mypy : error: Incompatible return value type (got "str", expected "int")
#             gate : PASSED - mypy type checking.
#             commit ALLOWED
#
#         Nothing in the output said "I did not look". That is the family this
#         series keeps finding: not-checked recorded as passed.
#
#         The fix checks the staged files directly when no scope is declared --
#         these are the exact files the author is asking to commit, and skipping
#         them was never what scope narrowing meant.
#
# @covers AC-PY-MYPY-01  a root-level type error is caught with no declared scope
# @covers AC-PY-MYPY-02  a declared scope still narrows (the fix must not ignore it)
# @covers AC-PY-MYPY-03  in-scope type errors are still caught
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO/githooks/lib/python-incremental-typecheck.sh"
}

_has_mypy() { command -v mypy >/dev/null 2>&1; }

@test "AC-PY-MYPY-01: a root-level type error is caught when no scope is declared" {
  _has_mypy || skip "mypy not on PATH"

  local dir="$BATS_TEST_TMPDIR/noscope"
  mkdir -p "$dir"
  printf 'def f() -> int:\n    return "not an int"\n' > "$dir/a.py"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    python_typecheck_incremental a.py >/dev/null 2>&1
    echo "RC=$?"
  ' _ "$dir" "$LIB"

  printf '%s' "$output" | grep -qE 'RC=[1-9]' || {
    echo "a type error went unreported with no declared scope:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-PY-MYPY-02: a declared scope still narrows what is checked" {
  _has_mypy || skip "mypy not on PATH"

  # Anti-over-reach. The whole point of .xp-gate-mypy-scope is to exclude files
  # outside it. A fix that simply checked everything would make large repositories
  # block on unrelated legacy code -- the opposite failure.
  local dir="$BATS_TEST_TMPDIR/scoped"
  mkdir -p "$dir/src" "$dir/vendor"
  printf 'src\n' > "$dir/.xp-gate-mypy-scope"
  printf 'def g() -> int:\n    return 0\n' > "$dir/src/ok.py"
  # Out of scope and broken; must NOT be reported.
  printf 'def h() -> int:\n    return "nope"\n' > "$dir/vendor/bad.py"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    python_typecheck_incremental vendor/bad.py >/dev/null 2>&1
    echo "RC=$?"
  ' _ "$dir" "$LIB"

  printf '%s' "$output" | grep -qE 'RC=0' || {
    echo "a file outside the declared scope was type-checked anyway:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-PY-MYPY-03: in-scope type errors are still caught" {
  _has_mypy || skip "mypy not on PATH"

  # Anti-vacuity for AC-02: proving out-of-scope files are skipped is worthless if
  # in-scope files are skipped too.
  local dir="$BATS_TEST_TMPDIR/inscope"
  mkdir -p "$dir/src"
  printf 'src\n' > "$dir/.xp-gate-mypy-scope"
  printf 'def g() -> int:\n    return "nope"\n' > "$dir/src/bad.py"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    python_typecheck_incremental src/bad.py >/dev/null 2>&1
    echo "RC=$?"
  ' _ "$dir" "$LIB"

  printf '%s' "$output" | grep -qE 'RC=[1-9]' || {
    echo "an in-scope type error was not reported:"
    printf '%s\n' "$output"
    false
  }
}
