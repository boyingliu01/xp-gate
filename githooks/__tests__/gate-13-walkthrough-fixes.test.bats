#!/usr/bin/env bats
# @test REQ-004
# @test REQ-005
# @test REQ-002
# @intent Gate 13 — fixes for the Phase-4 code-walkthrough findings.
#
#         Round 1 of the code walkthrough returned REQUEST_CHANGES from all three
#         seats. Each finding below was VERIFIED against the implementation before
#         being acted on — several expert claims did not survive that check and are
#         recorded as refuted rather than "fixed".
#
#         CONFIRMED AND FIXED
#           CI-01 / MI-02 (architecture, CRITICAL) — the Maven path redirected mvn's
#             output to /dev/null and derived its verdict purely from the exit code.
#             `mvn compile` exits 0 even when javac emitted -Xlint warnings, so the
#             gate printed "PASSED" no matter what. That is the exact defect this
#             whole gate exists to prevent, reproduced inside the gate itself.
#           MC-01 (technical, MAJOR) — gate13_run_analyzer ran twice: once at the
#             end of gate13_run_cpp_analysis and once in pre-commit's stage driver.
#           MA-02 (architecture, MAJOR) — one shared probe cache meant that after
#             the first flag was DROPPED, every cached flag reported "supported",
#             re-enabling flags the compiler had already rejected.
#           MC-03 (technical) — the bare-javac loop had no timeout.
#
#         REFUTED (kept as tests so they cannot regress into truth)
#           MA-01 — `grep -vc '^\s*$'` does NOT overcount; measured count 2 ==
#             actual `g++ ... | grep -c 'warning:'` of 2.
#           FC-01(C) — `local` inside the while loop is legal bash and is not a
#             scope bug; the loop body re-declares per iteration harmlessly.
#
# @covers AC-004-01, AC-004-02, AC-004-03, AC-005-02, AC-002-02

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

# ===========================================================================
# CI-01 — the Maven path must PARSE warnings, not trust the exit code.
# ===========================================================================

@test "CI-01: mvn output is captured, not discarded to /dev/null" {
  # The defect was literally `mvn ... >/dev/null 2>&1`. A log file plus a
  # grep is the fix; asserting the absence of the redirect pins it.
  run grep -c 'mvn_bin" \$args >/dev/null' "$GATE"
  [ "$output" -eq 0 ]
  run grep -n 'mvn_log' "$GATE"
  [ "$status" -eq 0 ]
}

@test "CI-01: a non-degraded Maven run with lint warnings returns FAIL, not PASS" {
  # fake mvn: exits 0 (success) but prints a javac -Xlint warning, exactly what
  # real Maven does when javac warns.
  cat > bin/mvn <<'EOF'
#!/usr/bin/env bash
cat <<'MSG'
[INFO] --- maven-compiler-plugin:3.13.0:compile (default-compile) @ demo ---
[WARNING] src/main/java/com/x/Raw.java:[7,20] [rawtypes] found raw type: List
  missing type arguments for generic class java.util.List<E>
[WARNING] src/main/java/com/x/Raw.java:[7,20] [rawtypes] found raw type: List
[INFO] BUILD SUCCESS
MSG
exit 0
EOF
  chmod +x bin/mvn
  export PATH="$TEST_DIR/bin:$PATH"

  mkdir -p src/main/java/com/x
  cat > src/main/java/com/x/Raw.java <<'EOF'
package com.x;
public class Raw { }
EOF
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.13.0</version>
  </plugin></plugins></build>
</project>
EOF
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_java_analysis
  [ "$status" -eq "$GATE13_FAIL" ]
  [[ "$output" != *"PASSED"* ]]
}

@test "CI-01: a clean non-degraded Maven run returns PASS" {
  cat > bin/mvn <<'EOF'
#!/usr/bin/env bash
echo "[INFO] BUILD SUCCESS"
exit 0
EOF
  chmod +x bin/mvn
  export PATH="$TEST_DIR/bin:$PATH"

  mkdir -p src/main/java/com/x
  echo 'package com.x; public class Clean { }' > src/main/java/com/x/Clean.java
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.13.0</version>
  </plugin></plugins></build>
</project>
EOF
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_java_analysis
  [ "$status" -eq "$GATE13_PASS" ]
}

@test "CI-01/Gradle: gradle output is captured too, and -q is not passed" {
  # -q suppresses the diagnostics, the same trap as Maven's -q.
  run grep -c 'compileJava -q' "$GATE"
  [ "$output" -eq 0 ]
  run grep -n 'g_log' "$GATE"
  [ "$status" -eq 0 ]
}

# ===========================================================================
# MC-01 — -fanalyzer must run exactly once per hook run.
# ===========================================================================

@test "MC-01: gate13_run_cpp_analysis does not call the analyzer itself" {
  # pre-commit's stage driver calls gate13_run_analyzer explicitly; a second call
  # from inside run_cpp_analysis doubled the slowest stage.
  # Count real CALLS: a line whose first token is the function name, excluding the
  # definition and excluding comments.
  local n
  n=$(grep -E '^[[:space:]]*gate13_run_analyzer[[:space:]]*$' "$GATE" | grep -vc '^[[:space:]]*#' || true)
  n=${n:-0}
  [ "$n" -eq 0 ]
}

@test "MC-01: pre-commit still drives the analyzer stage explicitly" {
  run grep -c 'gate13_run_analyzer' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# ===========================================================================
# MA-02 — the probe cache must not resurrect rejected flags.
# ===========================================================================

@test "MA-02: a dropped flag stays dropped after another flag is cached" {
  cat > bin/fakecxx <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    --version) echo "fakecxx 1.0"; exit 0 ;;
    -Wuseless-cast) echo "error: unrecognized command-line option '-Wuseless-cast'" >&2; exit 1 ;;
  esac
done
exit 0
EOF
  chmod +x bin/fakecxx

  load_gate
  GATE13_PROBE_CACHE=""
  GATE13_PROBE_DROPPED=""

  # Cache a supported flag first...
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wall"
  [ "$status" -eq 0 ]
  # ...then reject one...
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wuseless-cast"
  [ "$status" -ne 0 ]
  # ...and the rejected one must STILL be rejected on a second query.
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wuseless-cast"
  [ "$status" -ne 0 ]
}

@test "MA-02: a supported flag stays supported" {
  cat > bin/fakecxx <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "fakecxx 1.0"; exit 0; }
exit 0
EOF
  chmod +x bin/fakecxx

  load_gate
  GATE13_PROBE_CACHE=""
  GATE13_PROBE_DROPPED=""
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wextra"
  [ "$status" -eq 0 ]
  run gate13_flag_supported "$TEST_DIR/bin/fakecxx" "-Wextra"
  [ "$status" -eq 0 ]
}

# ===========================================================================
# MC-03 — the bare-javac loop must respect the timeout budget.
# ===========================================================================

@test "MC-03: the bare javac path is timeout-bounded" {
  # A pathological file can make javac hang; a hook must not hang with it.
  run grep -n 'gate13_javac_warning_count' "$GATE"
  [ "$status" -eq 0 ]
  # The javac invocation itself must go through timeout when available.
  run grep -A8 'gate13_javac_warning_count()' "$GATE"
  [[ "$output" == *"timeout"* ]]
}

# ===========================================================================
# REFUTED claims — pinned so nobody "fixes" a non-bug into a bug.
# ===========================================================================

@test "REFUTED MA-01: the C warning counter matches g++'s own warning count" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  cat > a.cpp <<'EOF'
#include <cstring>
#include <string>
class Base { public: ~Base() {} virtual void f() {} };
int main(int argc, char**) {
  int a = argc;
  if (a = 3) { }
  std::string s = "x";
  memset(&s, 0, sizeof s);
  return 0;
}
EOF
  load_gate
  local ours theirs
  ours=$(gate13_count_warnings g++ "-Wall -Wextra" a.cpp)
  theirs=$(g++ -fsyntax-only -Wall -Wextra a.cpp 2>&1 | grep -c 'warning:')
  [ "$ours" -eq "$theirs" ]
}

@test "REFUTED FC-01: 'local' inside the analysis loop is not an error" {
  # The loop body declares its temporaries with `local`; that is legal in bash
  # and re-declares harmlessly per iteration. Assert the script parses and runs.
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  echo 'int main(){return 0;}' > clean.cpp
  git add -A >/dev/null 2>&1
  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_PASS" ]
}
