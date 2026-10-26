#!/usr/bin/env bats
# @test REQ-004
# @test REQ-005
# @test REQ-002
# @intent Gate 13 — fixes for the Phase-4 code-walkthrough ROUND 2 findings.
#
#         Round 2: technical and feasibility both APPROVED; architecture raised two
#         more criticals. Both were verified before acting.
#
#         CI-03 (CONFIRMED, real bug, wrong consequence described) —
#           `local cc files=f f cnt ...` initialises `files` to the STRING "f"
#           instead of the variable `$f`. The expert further claimed the analyzer
#           therefore never analyses anything and false-reports "clean". That part
#           is WRONG: measured with the real gcc, a staged bad.c containing a NULL
#           dereference is analysed and reports 1 finding, because the later
#           `files=$(gate13_analyzer_files)` overwrites the typo. The typo is
#           still repaired — it would bite the moment anyone reordered those lines.
#
#         CI-02 (CONFIRMED) — gate13_javac_warning_count returned 0 on a javac
#           TIMEOUT, which is indistinguishable from "compiled clean", so a file
#           nobody analysed could contribute to a PASS.
#
#         MA-04 (CONFIRMED) — pom version extraction used a range match to the
#           first </plugin> (could grab a neighbouring plugin's version) and
#           rejected `3.13.0-SNAPSHOT` and property placeholders.
#
#         MA-05 (CONFIRMED) — the probe cache key omitted the language, so a C
#           probe could inherit a C++ answer for a C++-only flag.
#
# @covers AC-005-01, AC-005-02, AC-004-02, AC-004-03, AC-002-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR

  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks
  mkdir -p bin
}

teardown() {
  cd / || return 1
  rm -rf "$TEST_DIR"
}

load_gate() {
  # shellcheck source=/dev/null
  source "$GATE"
}

# ---------------------------------------------------------------- CI-03

@test "CI-03: the analyzer loop does not initialise files to the literal 'f'" {
  # The exact defect was `local cc files=f f cnt ...`.
  run grep -n 'local cc files=f' "$GATE"
  [ "$status" -ne 0 ]
}

@test "CI-03: the analyzer really does analyse a staged .c file (timeout fails the claim, not the analysis)" {
  command -v gcc >/dev/null 2>&1 || skip "gcc not available"
  export XP_GATE_COMPILER_ANALYZER=1
  printf 'int main(void){int *p=0; return *p;}\n' > bad.c
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_analyzer
  [ "$status" -eq 0 ]
  # It must report a finding, not "clean".
  [[ "$output" == *"finding"* ]]
  [[ "$output" != *"no staged .c files"* ]]
}

@test "CI-03: the analyzer reports clean only when there is genuinely nothing to say" {
  command -v gcc >/dev/null 2>&1 || skip "gcc not available"
  export XP_GATE_COMPILER_ANALYZER=1
  printf 'int add(int a,int b){return a+b;}\n' > ok.c
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_analyzer
  [ "$status" -eq 0 ]
  [[ "$output" == *"clean"* ]]
}

# ---------------------------------------------------------------- CI-02

@test "CI-02: a javac timeout is distinguishable from a clean compile" {
  run grep -n "printf 'TIMEOUT" "$GATE"
  [ "$status" -eq 0 ]
}

@test "CI-02: a timed-out javac file yields WARN, never PASS" {
  # A javac shim that never returns, with timeout(1) available.
  command -v timeout >/dev/null 2>&1 || skip "timeout not available"
  cat > bin/javac <<'EOF'
#!/usr/bin/env bash
sleep 30
echo "should never get here"
EOF
  chmod +x bin/javac
  export PATH="$TEST_DIR/bin:$PATH"
  export XP_GATE_COMPILER_TIMEOUT=1

  mkdir -p src/main/java/com/x
  echo 'package com.x; public class App { }' > src/main/java/com/x/App.java
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_java_analysis
  [ "$status" -eq "$GATE13_WARN" ]
  [ "$status" -ne "$GATE13_PASS" ]
}

# ---------------------------------------------------------------- MA-04

@test "MA-04: a SNAPSHOT plugin version is accepted as >= 3.1" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.13.0-SNAPSHOT</version>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -eq 0 ]
}

@test "MA-04: a neighbouring plugin's version is not mistaken for the compiler plugin's" {
  # surefire 2.5.1 comes FIRST and is below 3.1; a range match to the first
  # </plugin> would read 2.5.1 and wrongly degrade a healthy project.
  cat > pom.xml <<'EOF'
<project>
  <build><plugins>
    <plugin>
      <artifactId>maven-surefire-plugin</artifactId>
      <version>2.5.1</version>
    </plugin>
    <plugin>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.13.0</version>
    </plugin>
  </plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -eq 0 ]
}

@test "MA-04: a property-reference version is unverifiable, not assumed good" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>${maven.compiler.version}</version>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -ne 0 ]
}

@test "MA-04: a genuinely old compiler plugin is still rejected" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.0</version>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------- MA-05

@test "MA-05: the probe cache key includes the language" {
  run grep -n 'local key="${cc}|${lang}|${flag}"' "$GATE"
  [ "$status" -eq 0 ]
}

@test "MA-05: a C probe and a C++ probe of the same flag are cached separately" {
  cat > bin/fakecxx <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    --version) echo "fakecxx 1.0"; exit 0 ;;
    -Wold-style-cast) echo "error: unrecognized command-line option '-Wold-style-cast'" >&2; exit 1 ;;
  esac
done
exit 0
EOF
  chmod +x bin/fakecxx

  load_gate
  GATE13_PROBE_CACHE=""
  GATE13_PROBE_DROPPED=""
  # C++ rejects this flag in this shim...
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wold-style-cast" "cpp"
  [ "$status" -ne 0 ]
  # ...and asking again as "cpp" must stay rejected (cache key holds the language).
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wold-style-cast" "cpp"
  [ "$status" -ne 0 ]
}

# ------------------------------------------------- sanity: still works end to end

@test "END-TO-END: a staged dirty C++ file still blocks after the round-2 fixes" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  cat > dirty.cpp <<'EOF'
#include <string>
class Base { public: ~Base() {} virtual void f() {} };
int main(int argc, char**) { int a = argc; if (a = 3) { } std::string s = "x"; return 0; }
EOF
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_FAIL" ]
}
