#!/usr/bin/env bats
#
# @test REQ-KOTLIN-TYPECHECK the Kotlin adapter declares a compile-time checker
# @intent The language matrix's kotlin dirty row read G1=PASS G13=SKIP, and both
#         answers were individually correct:
#
#           Gate 1  runs ktlint and detekt. Both LINT. Neither type-checks.
#           Gate 13 asks the adapter for compiler_check_command and finds none.
#
#         So nothing in the chain looked for a Kotlin type error, and the two
#         gates covering the language between them recorded a pass and a skip.
#
#         Measured 2026-11-19:
#
#             a.kt : fun intOf(v: Int): Int = v
#                    fun main() { println(intOf("not an int")) }
#             kotlinc : error: argument type mismatch: actual type is 'String',
#                       but 'Int' was expected.
#             gate 1  : PASSED
#             gate 13 : SKIPPED (no compiler declared)  -> commit ALLOWED
#
#         Linting and type-checking answer different questions. Kotlin had only
#         the first asked anywhere.
#
# @covers AC-KT-TC-01  the adapter declares a checker
# @covers AC-KT-TC-02  the declared command reports a type error as non-zero
# @covers AC-KT-TC-03  the declared command passes clean code (anti-vacuity)
# @covers AC-KT-TC-04  the check leaves no build output behind
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO/githooks/adapters/kotlin.sh"
}

_has_kotlinc() { command -v kotlinc >/dev/null 2>&1; }

@test "AC-KT-TC-01: the Kotlin adapter declares compiler_check_command" {
  run bash -c '
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || exit 1
    declare -f compiler_check_command >/dev/null 2>&1 || { echo "NOT DECLARED"; exit 1; }
    cmd=$(compiler_check_command)
    [ -n "$cmd" ] || { echo "EMPTY"; exit 1; }
    printf "%s" "$cmd" | grep -q kotlinc || { echo "NO KOTLINC: $cmd"; exit 1; }
    echo OK
  ' _ "$ADAPTER"

  printf '%s' "$output" | grep -q OK || {
    echo "kotlin declares no compile-time checker, so Gate 13 skips it:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-KT-TC-02: the declared command fails on a type error" {
  _has_kotlinc || skip "kotlinc not on PATH"

  local dir="$BATS_TEST_TMPDIR/bad"
  mkdir -p "$dir"
  printf 'fun intOf(v: Int): Int = v\n\nfun main() {\n    println(intOf("not an int"))\n}\n' > "$dir/a.kt"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    cmd=$(compiler_check_command)
    bash -c "$cmd" >"$1/out.txt" 2>&1
    echo "RC=$?"
    head -3 "$1/out.txt"
  ' _ "$dir" "$ADAPTER"

  printf '%s' "$output" | grep -qE 'RC=[1-9]' || {
    echo "the declared checker passed code kotlinc rejects:"
    printf '%s\n' "$output"
    false
  }
  printf '%s' "$output" | grep -qiE 'error|mismatch' || {
    echo "non-zero, but no diagnostic was captured:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-KT-TC-03: the declared command passes clean code" {
  _has_kotlinc || skip "kotlinc not on PATH"

  # Anti-vacuity. A command that always fails would satisfy AC-02 and block every
  # Kotlin commit -- the gate would be "working" and unusable.
  local dir="$BATS_TEST_TMPDIR/good"
  mkdir -p "$dir"
  printf 'fun intOf(v: Int): Int = v\n\nfun main() {\n    println(intOf(1))\n}\n' > "$dir/a.kt"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    cmd=$(compiler_check_command)
    bash -c "$cmd" >"$1/out.txt" 2>&1
    echo "RC=$?"
  ' _ "$dir" "$ADAPTER"

  printf '%s' "$output" | grep -qE 'RC=0' || {
    echo "clean Kotlin code was rejected:"
    printf '%s\n' "$output"
    cat "$dir/out.txt" 2>/dev/null | head -5
    false
  }
}

@test "AC-KT-TC-04: the check leaves no compiled output in the tree" {
  _has_kotlinc || skip "kotlinc not on PATH"

  # The check runs `kotlinc ... -d <tmp>`; pointing that at the working directory
  # would drop .class files into the repo, and the next commit's change set would
  # depend on whether the gate had run.
  local dir="$BATS_TEST_TMPDIR/clean"
  mkdir -p "$dir"
  printf 'fun intOf(v: Int): Int = v\n\nfun main() {\n    println(intOf(1))\n}\n' > "$dir/a.kt"

  bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    bash -c "$(compiler_check_command)" >/dev/null 2>&1 || true
  ' _ "$dir" "$ADAPTER"

  local leftovers
  leftovers=$(cd "$dir" && ls *.class *.jar 2>/dev/null | wc -l)
  [ "$leftovers" -eq 0 ] || {
    echo "the compiler check left build output in the working tree:"
    ls -la "$dir" | head -8
    false
  }
}
