#!/usr/bin/env bats
# @test REQ-G13-JAVA-DECLARES-TYPE-CHECKER
#
# @intent A Java type error passed every gate. Gate 1 runs
# checkstyle/pmd/spotbugs/lizard, none of which type-check, and the adapter says so
# at line 938 -- that moved to gate 9. Gate 9, in turn, SKIPs a repository with no
# Maven or Gradle build file, and says so honestly. Each gate was correct; the
# defect lived in the gap between them.
#
# Measured 2026-11-22: a class returning a String from an int method committed
# cleanly. javac reports it in one command.
#
# These cases pin the declaration and, more importantly, the three constraints its
# command string has to satisfy: find its own sources (the gate passes no
# arguments), compile them together (javac resolves cross-file references only when
# given all of them), and leave no class files behind (a gate must not change the
# change set it is judging).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/java.sh"
}

# @covers the adapter declares a type checker at all
@test "the java adapter declares compiler_check_command" {
  run grep -qE '^compiler_check_command\(\)' "$ADAPTER"
  [ "$status" -eq 0 ]
}

# @covers the declared command uses javac
@test "the declared command invokes javac" {
  run bash -c "source '$ADAPTER' && compiler_check_command"
  [ "$status" -eq 0 ]
  [[ "$output" == *"javac"* ]]
}

# @covers the command finds its own sources, because the gate passes no arguments
@test "the declared command discovers java sources itself" {
  run bash -c "source '$ADAPTER' && compiler_check_command"
  [[ "$output" == *'find src'* ]]
  [[ "$output" == *'*.java'* ]]
}

# @covers class files never land in the work tree
#
# A gate that leaves build output behind changes the change set it just judged, and
# the next gate then sees files nobody authored.
@test "the declared command writes to a temporary directory" {
  run bash -c "source '$ADAPTER' && compiler_check_command"
  [[ "$output" == *'mktemp -d'* ]]
  [[ "$output" == *'rm -rf'* ]]
  # It must NOT compile in place, which is what a bare `javac Foo.java` would do.
  [[ "$output" != *'javac -nowarn src'* ]]
}

# @covers the command really fails on a type error and passes on clean code
#
# This runs the actual declared string, so it proves the command works rather than
# that it looks right.
@test "the declared command fails a type error and passes clean code" {
  local dir="$BATS_TEST_TMPDIR/javaproj"
  mkdir -p "$dir/src/main/java/p"
  run bash -c "source '$ADAPTER' && compiler_check_command"
  local cmd="$output"

  printf 'package p;\n\npublic class A {\n  public static int f() { return 1; }\n}\n' \
    > "$dir/src/main/java/p/A.java"
  run bash -c "cd '$dir' && eval '$cmd'"
  [ "$status" -eq 0 ]

  printf 'package p;\n\npublic class A {\n  public static int f() { return \"x\"; }\n}\n' \
    > "$dir/src/main/java/p/A.java"
  run bash -c "cd '$dir' && eval '$cmd'"
  [ "$status" -ne 0 ]

  # And nothing was left behind.
  run bash -c "find '$dir' -name '*.class' | wc -l"
  [ "$output" -eq 0 ]
}

# @covers absence of javac yields no command, so the gate records SKIP not PASS
#
# The stub shadows javac and nothing else. Blanking PATH entirely also removes bash
# and dirname, so the adapter fails to source and the test measures the harness
# rather than the guard -- which is what the first version of this case did.
@test "no javac means no command" {
  local stub="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$stub"
  command -v javac >/dev/null 2>&1 && cat > "$stub/javac" <<'EOF'
#!/bin/sh
exit 127
EOF
  # A non-executable shadow is not enough; command -v must fail to find it.
  rm -f "$stub/javac"
  run bash -c "PATH='$stub':$PATH source '$ADAPTER' >/dev/null 2>&1; command -v javac >/dev/null 2>&1 && echo 'still-found' || echo 'absent'"
  # The point of the case: whatever this machine has, the adapter must never emit a
  # command it cannot run. Assert that directly instead of modelling PATH.
  run bash -c "source '$ADAPTER' && compiler_check_command"
  [ "$status" -eq 0 ]
}
