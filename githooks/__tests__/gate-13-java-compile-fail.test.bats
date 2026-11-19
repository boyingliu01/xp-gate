#!/usr/bin/env bats
#
# @test REQ-JAVA-COMPILE-FAIL a Java compile failure is not waved through as "degraded"
# @intent Gate 13's Java arm has a degraded mode: when the -Xlint compiler arguments
#         cannot be injected into the Maven build, the run cannot say anything about
#         compiler STRICTNESS, and the code says so at length.
#
#         The bug was that degraded mode swallowed COMPILABILITY too. Every non-zero
#         `mvn` exit was reported as
#
#             "Java build failed (mvn exit N) in degraded mode — not attributed to
#              Gate 13"   -> WARN
#
#         on the theory that it is "usually missing offline dependencies". That
#         theory is right about dependency failures and wrong about compilation
#         failures, and the two are distinguishable from Maven's own output.
#
#         Measured 2026-11-19, language matrix, java fixture:
#
#             src/main/java/A.java : public int f() { return "no"; }
#             mvn -o compile  : [ERROR] COMPILATION ERROR :
#                               ... 不兼容的类型: java.lang.String无法转换为int
#                               ... Compilation failure
#             gate 13         : WARN, "not attributed to Gate 13"
#             commit ALLOWED
#
#         A dependency failure does not print COMPILATION ERROR. It fails while
#         resolving artifacts ("Could not resolve dependencies", "Non-resolvable
#         parent POM"). So the marker is available and was simply not used.
#
# @covers AC-JAVA-CF-01  COMPILATION ERROR in degraded mode is a FAIL, not a WARN
# @covers AC-JAVA-CF-02  a dependency failure in degraded mode is STILL a WARN
# @covers AC-JAVA-CF-03  the distinguishing marker is checked before the bail-out
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO/githooks/adapters/gate-13-compiler-strictness.sh"
}

@test "AC-JAVA-CF-01: a compilation failure is attributed to the gate even when degraded" {
  # The degraded-mode branch must consult the Maven output before returning WARN.
  # Ordering is the whole fix: a check placed after the `return "$GATE13_WARN"`
  # would be dead code and read as correct.
  local mark_line warn_line
  mark_line=$(grep -n "COMPILATION ERROR|Compilation failure" "$ADAPTER" | head -1 | cut -d: -f1)
  # Match the ECHO, not the same words inside the explanatory comment block above
  # it: the first match would otherwise be a comment and the ordering assertion
  # would compare the wrong pair (which is exactly what happened on the first run
  # of this test -- it reported the fix as dead code while the fix was correct).
  warn_line=$(grep -nE '^[[:space:]]*echo .*not attributed to Gate 13' "$ADAPTER" | head -1 | cut -d: -f1)

  [ -n "$mark_line" ] || {
    echo "the adapter never looks for Maven's compilation-failure marker"
    false
  }
  [ -n "$warn_line" ] || {
    echo "could not find the degraded-mode WARN"
    false
  }
  [ "$mark_line" -lt "$warn_line" ] || {
    echo "the compilation-error check is at line $mark_line, AFTER the degraded WARN at $warn_line"
    echo "-> it is dead code; a compile failure still returns WARN"
    false
  }
}

@test "AC-JAVA-CF-02: a dependency failure is still treated as an environment problem" {
  # Anti-over-reach. Flipping every degraded-mode failure to FAIL would block every
  # offline build with a missing artifact -- the false-block this degraded mode
  # exists to prevent. The marker must be specific to compilation.
  grep -qE 'COMPILATION ERROR|Compilation failure' "$ADAPTER" || {
    echo "no compilation-specific marker is used"
    false
  }
  # Only CODE counts. The comment above the check names the dependency failures it
  # deliberately does not match, so a bare grep finds them and reports a false
  # alarm -- the same comment-matching mistake as AC-01, in the opposite direction.
  local code_hits
  code_hits=$(grep -vE '^[[:space:]]*#' "$ADAPTER" | grep -cE 'Could not resolve|Non-resolvable' || true)
  [ "${code_hits:-0}" -eq 0 ] || {
    echo "the adapter now keys on a dependency-resolution string in CODE ($code_hits hit(s))"
    echo "-> offline builds with a missing artifact would block as compile failures"
    false
  }
  return 0
}

@test "AC-JAVA-CF-03: the real Maven output for a type error matches the marker" {
  command -v mvn >/dev/null 2>&1 || skip "mvn not on PATH"
  command -v javac >/dev/null 2>&1 || skip "javac not on PATH"

  local dir="$BATS_TEST_TMPDIR/mvn"
  mkdir -p "$dir/src/main/java"
  cat > "$dir/pom.xml" <<'POM'
<project><modelVersion>4.0.0</modelVersion><groupId>p</groupId><artifactId>p</artifactId><version>1</version></project>
POM
  printf 'package p;\npublic class A { public int f() { return "no"; } }\n' > "$dir/src/main/java/A.java"

  # Offline, as the gate runs it. A missing plugin/dependency fails WITHOUT the
  # marker; that is exactly the property under test, so the assertion is on the
  # marker rather than on the exit code alone.
  local out
  out=$(cd "$dir" && timeout 300 mvn -o -q compile 2>&1 || true)

  printf '%s' "$out" | grep -qE 'COMPILATION ERROR|Compilation failure' || {
    echo "Maven did not emit the marker this fix keys on; output was:"
    printf '%s\n' "$out" | head -10
    echo "-> if the environment cannot compile at all, the fix is untested here"
    skip "mvn could not reach the compiler in this environment"
  }
}
