#!/usr/bin/env bats
#
# @test REQ-FLUTTER-TYPECHECK a project detected as Flutter still gets a Dart type check
# @intent Gate 13 asks each detected language's adapter for compiler_check_command.
#         A project with a pubspec.yaml that mentions flutter: is detected as
#         `flutter`, not `dart` (measured: gate 0's extension mapping, then
#         `xp-gate detect-languages` printing "Flutter (flutter)").
#
#         dart.sh declared the capability. flutter.sh did not. So the SAME Dart
#         source was type-checked or not depending on which of two adapters the
#         detector happened to pick:
#
#             lib/a.dart : int f() { return "not an int"; }
#             dart analyze: error - A value of type 'String' can't be returned
#                           from the function 'f' ... - return_of_invalid_type
#             gate 13 (flutter-detected project): SKIPPED -> commit ALLOWED
#
#         A Flutter project is a Dart project with a UI framework on top.
#         `dart analyze` answers Gate 13's compile-time question for both, so the
#         capability is declared by both adapters rather than by whichever name
#         wins detection.
#
#         NOTE on how this was actually found: the matrix showed dart G13=SKIP and
#         the first hypothesis was a missing declaration. Adding it here did NOT
#         change the outcome -- the real cause was a STALE GLOBAL COPY of dart.sh
#         under ~/.config/xp-gate/adapters/ (the trap in githooks/AGENTS.md).
#         This declaration is still correct and still needed: it closes the
#         flutter-detected half, which the stale copy was not hiding.
#
# @covers AC-FLUTTER-TC-01  flutter.sh declares compiler_check_command
# @covers AC-FLUTTER-TC-02  it declares the SAME command dart.sh does
# @covers AC-FLUTTER-TC-03  the command reports a Dart type error as non-zero
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  FLUTTER="$REPO/githooks/adapters/flutter.sh"
  DART="$REPO/githooks/adapters/dart.sh"
}

_has_dart() { command -v dart >/dev/null 2>&1; }

@test "AC-FLUTTER-TC-01: flutter.sh declares compiler_check_command" {
  run bash -c '
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || exit 1
    declare -f compiler_check_command >/dev/null 2>&1 || { echo NOT_DECLARED; exit 1; }
    c=$(compiler_check_command)
    [ -n "$c" ] || { echo EMPTY; exit 1; }
    echo "CMD=$c"
  ' _ "$FLUTTER"

  printf '%s' "$output" | grep -q '^CMD=' || {
    echo "a Flutter-detected project gets no compile-time check at all:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-FLUTTER-TC-02: Flutter and Dart declare the same compile-time check" {
  # They must agree: the difference between the two names is a UI framework, not
  # the language. If they diverge, the same source is checked differently based on
  # a pubspec keyword.
  local fcmd dcmd
  fcmd=$(bash -c '. "$1" >/dev/null 2>&1; compiler_check_command' _ "$FLUTTER")
  dcmd=$(bash -c '. "$1" >/dev/null 2>&1; compiler_check_command' _ "$DART")

  [ -n "$fcmd" ] && [ -n "$dcmd" ] || {
    echo "one of the two adapters does not declare a checker (flutter='$fcmd' dart='$dcmd')"
    false
  }
  [ "$fcmd" = "$dcmd" ] || {
    echo "flutter declares '$fcmd' but dart declares '$dcmd'"
    echo "-> the same .dart file is checked one way or the other depending on a pubspec keyword"
    false
  }
}

@test "AC-FLUTTER-TC-03: the declared Flutter checker fails on a Dart type error" {
  _has_dart || skip "dart not on PATH"

  local dir="$BATS_TEST_TMPDIR/fl"
  mkdir -p "$dir/lib"
  printf 'name: probe\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n' > "$dir/pubspec.yaml"
  printf 'int f() {\n  return "not an int";\n}\n' > "$dir/lib/a.dart"

  run bash -c '
    cd "$1" || exit 1
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    c=$(compiler_check_command)
    eval "$c" >out.txt 2>&1
    echo "RC=$?"
    head -2 out.txt
  ' _ "$dir" "$FLUTTER"

  printf '%s' "$output" | grep -qE 'RC=[1-9]' || {
    echo "the Flutter checker passed code dart analyze rejects:"
    printf '%s\n' "$output"
    false
  }
}
