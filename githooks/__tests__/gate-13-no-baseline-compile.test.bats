#!/usr/bin/env bats
#
# @test REQ-GATE13-NOBASELINE a file that does not compile is blocked even with no baseline
# @intent Gate 13's modified-file path has two exemptions, and it merged them:
#
#           - the BASELINE RATCHET: "no worse than before" is legitimate, because
#             adopting the gate must not mean clearing every pre-existing warning
#             first.
#           - COMPILABILITY: an error is not inherited debt. A file that does not
#             build cannot be running anywhere.
#
#         The "no baseline entry" branch took the ratchet exemption and made it
#         cover errors too, so it printed a count and `continue`d.
#
#         Measured 2026-11-19, cpp fixture in the language matrix:
#
#             a.cpp = int main() { return not_a_symbol; }
#             g++   = error: 'not_a_symbol' was not declared in this scope
#             gate  = SKIP  (no baseline) -> commit ALLOWED
#
#         This is the ordinary case, not a corner: any existing C/C++ project has
#         modified files and no baseline until someone runs
#         `xp-gate compiler-baseline create`, and until then a non-compiling edit
#         passed unnoticed.
#
#         The fix separates the two questions into two functions. gate13_count_warnings
#         answers "is this worse than clean" (the ratchet); gate13_count_errors
#         answers "does this compile at all" (absolute). Only the second applies
#         when no baseline entry exists.
#
# @covers AC-GATE13-NB-01  a non-compiling modified file with no baseline blocks
# @covers AC-GATE13-NB-02  the same file with only WARNINGS stays report-only
# @covers AC-GATE13-NB-03  error and warning counting are separate functions
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO/githooks/adapters/gate-13-compiler-strictness.sh"
}

_has_cxx() {
  command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1
}

@test "AC-GATE13-NB-01: a non-compiling modified file is blocked without a baseline" {
  _has_cxx || skip "no C++ compiler on PATH"

  local dir="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$dir"
  printf 'int broken() { return not_a_symbol; }\n' > "$dir/a.cpp"

  run bash -c '
    set -u
    PROJECT_ROOT="$1"
    CHANGED_FILES="a.cpp"
    XP_STAGED_ACM="a.cpp"
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    # Ask the two questions the gate asks, in the same order and with the same
    # inputs, rather than driving the whole arm (which needs a compiler tier,
    # a budget and a project layout).
    cxx=$(command -v g++ || command -v clang++)
    errs=$(gate13_count_errors "$cxx" "-Wall -Wextra" "a.cpp")
    echo "ERRORS=$errs"
  ' _ "$dir" "$ADAPTER"

  printf '%s' "$output" | grep -qE 'ERRORS=[1-9]' || {
    echo "a file that does not compile reported zero errors:"
    printf '%s\n' "$output"
    false
  }

  # And the gate must give it a verdict rather than continuing.
  grep -q 'gate13_count_errors' "$ADAPTER" || {
    echo "the gate never asks the compilability question"
    false
  }
  # The report-only line must sit AFTER an error check, not replace it.
  local errline refline
  errline=$(grep -n '_g13_errs=$(gate13_count_errors' "$ADAPTER" | head -1 | cut -d: -f1)
  # Match the ECHO that prints it, not the same words in the comment block above:
  # requiring "echo" in the line is what tells them apart. Matching the bare
  # phrase picked up a comment ~900 lines earlier and compared the wrong pair.
  refline=$(grep -n 'echo.*no baseline entry, report-only' "$ADAPTER" | head -1 | cut -d: -f1)
  [ -n "$errline" ] && [ -n "$refline" ] || {
    echo "could not locate the error check (got '$errline') or the report-only echo (got '$refline')"
    false
  }
  [ "$errline" -lt "$refline" ] || {
    echo "the report-only line (line $refline) comes before the error check (line $errline)"
    echo "-> an error would still fall through to report-only"
    false
  }
}

@test "AC-GATE13-NB-02: warnings alone still get the ratchet exemption" {
  _has_cxx || skip "no C++ compiler on PATH"

  # Anti-over-reach. The fix must block ERRORS, not everything: a modified file
  # with pre-existing warnings and no baseline entry is exactly what report-only
  # exists for. Blocking it would make the gate unusable on adoption.
  local dir="$BATS_TEST_TMPDIR/warn"
  mkdir -p "$dir"
  # -Wunused-variable fires; the file compiles.
  printf 'int f() { int unused = 1; return 0; }\n' > "$dir/b.cpp"

  run bash -c '
    set -u
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    cxx=$(command -v g++ || command -v clang++)
    echo "ERRORS=$(gate13_count_errors "$cxx" "-Wall -Wextra" "b.cpp")"
    echo "ALL=$(gate13_count_warnings "$cxx" "-Wall -Wextra" "b.cpp")"
  ' _ "$dir" "$ADAPTER"

  printf '%s' "$output" | grep -q 'ERRORS=0' || {
    echo "a compiling file was counted as having errors:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE13-NB-03: error counting is its own function" {
  # The separation is the fix. If a future edit folds errors back into
  # gate13_count_warnings and reuses it on the no-baseline path, the defect
  # returns -- so pin that the two exist independently and that the error counter
  # greps for error: ONLY.
  grep -q '^gate13_count_errors()' "$ADAPTER" || {
    echo "gate13_count_errors no longer exists"
    false
  }
  grep -q '^gate13_count_warnings()' "$ADAPTER" || {
    echo "gate13_count_warnings no longer exists"
    false
  }

  local body
  body=$(awk '/^gate13_count_errors\(\)/{f=1} f{print} f&&/^}/{exit}' "$ADAPTER")
  printf '%s' "$body" | grep -q "grep -E 'error:'" || {
    echo "gate13_count_errors does not count error: lines"
    false
  }
  printf '%s' "$body" | grep -q "grep -E 'warning:'" && {
    echo "gate13_count_errors also counts warning: -- it is supposed to answer"
    echo "only 'does this compile', and folding warnings back in is the defect"
    false
  }
  return 0
}
