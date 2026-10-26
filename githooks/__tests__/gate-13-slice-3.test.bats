#!/usr/bin/env bats
# @test REQ-004
# @intent Gate 13 — SLICE-3: Java compiler strictness.
#
#         Measured: a Java file with `List raw = l;` produces ZERO diagnostics
#         from bare `javac`. `-Xlint:all` reports `[rawtypes]`, and adding
#         `-Werror` turns that into `error: warnings found` (exit 1). Maven
#         propagates the same args through maven-compiler-plugin's compilerArgs
#         (verified BUILD FAILURE, exit 1, on a raw-type fixture).
#
#         But `mvn -q` — what Gate 9 currently runs — suppresses non-error
#         diagnostics, so `-q` and "parse the warning lines" are mutually
#         exclusive. Requirement round 2 (architecture CI-02) caught exactly that
#         contradiction in the v1 requirement; this implementation uses `-B`
#         (batch mode: no colour, no progress) so warnings stay parseable.
#
#         Two more review findings shape this slice:
#           MC-01 / FC-01 — `-Dmaven.compiler.compilerArgument` is a SINGLE
#             appended argument and may be overridden by an existing
#             <compilerArgs> block, or ignored by an old plugin. The gate must
#             VERIFY injectability and degrade to warn-only with a loud banner
#             rather than pretend it checked anything.
#           FC-02 — JVM/analyser startup and dependency resolution can hang; the
#             offline flag plus the timeout budget keep a hook from stalling.
#
# @covers AC-004-01, AC-004-02, AC-004-03

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
  mkdir -p bin src/main/java/com/x
}

teardown() {
  cd / || return 1
  rm -rf "$TEST_DIR"
}

load_gate() {
  # shellcheck source=/dev/null
  source "$GATE"
}

# ------------------------------------------------- AC-004-01 maven flags

@test "AC-004-01: the Maven invocation uses -B, never -q" {
  load_gate
  run gate13_maven_args
  [ "$status" -eq 0 ]
  [[ "$output" == *"-B"* ]]
  # -q is the whole problem this requirement exists to fix.
  [[ "$output" != *" -q "* ]]
  [[ "$output" != *" -q" ]]
}

@test "AC-004-01: the Maven invocation requests -Xlint:all with processing disabled" {
  load_gate
  run gate13_maven_args
  [[ "$output" == *"-Xlint:all,-processing"* ]]
}

@test "AC-004-01: the Maven invocation enables warning output" {
  load_gate
  run gate13_maven_args
  [[ "$output" == *"showWarnings=true"* ]]
}

@test "AC-004-01: the Maven invocation runs offline" {
  load_gate
  run gate13_maven_args
  [[ "$output" == *"-o"* ]]
}

@test "AC-004-01: the Maven invocation skips tests" {
  load_gate
  run gate13_maven_args
  [[ "$output" == *"-DskipTests"* ]]
}

# ------------------------------------- AC-004-02 injection reliability

@test "AC-004-02: a pom that already carries <compilerArgs> is treated as unreliable" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.13.0</version>
    <configuration>
      <compilerArgs><arg>-Xlint:all</arg></compilerArgs>
    </configuration>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -ne 0 ]
  [[ "$output" == *"compilerArgs"* ]]
}

@test "AC-004-02: a pom with maven-compiler-plugin older than 3.1 is unreliable" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>2.5.1</version>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -ne 0 ]
}

@test "AC-004-02: a pom declaring no compiler plugin version is unreliable" {
  cat > pom.xml <<'EOF'
<project><modelVersion>4.0.0</modelVersion></project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -ne 0 ]
}

@test "AC-004-02: a pom with plugin >= 3.1 and no compilerArgs is reliable" {
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.13.0</version>
  </plugin></plugins></build>
</project>
EOF
  load_gate
  run gate13_maven_injection_reliable pom.xml
  [ "$status" -eq 0 ]
}

@test "AC-004-02: an unreliable injection degrades to warn-only with a prominent banner" {
  command -v mvn >/dev/null 2>&1 || skip "mvn not available"
  cat > pom.xml <<'EOF'
<project>
  <build><plugins><plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>2.5.1</version>
  </plugin></plugins></build>
</project>
EOF
  cat > src/main/java/com/x/App.java <<'EOF'
package com.x;
public class App { public static void main(String[] a) {} }
EOF
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_run_java_analysis
  # Never a fake PASS and never a hard BLOCK for a config we cannot verify.
  [ "$status" -eq "$GATE13_WARN" ]
  [[ "$output" == *"unreliable"* || "$output" == *"DEGRADED"* ]]
}

# ------------------------------------------- AC-004-03 bare javac path

@test "AC-004-03: with no build file the gate falls back to bare javac -Xlint:all" {
  load_gate
  run gate13_javac_args
  [ "$status" -eq 0 ]
  [[ "$output" == *"-Xlint:all,-processing"* ]]
}

@test "AC-004-03: a flat source tree is found when there is no build file" {
  cat > src/main/java/com/x/App.java <<'EOF'
package com.x;
public class App { public static void main(String[] a) {} }
EOF
  git add -A >/dev/null 2>&1
  load_gate
  run gate13_java_sources
  [ "$status" -eq 0 ]
  [[ "$output" == *"App.java"* ]]
}

@test "AC-004-03: bare javac detects a raw type that plain javac cannot" {
  command -v javac >/dev/null 2>&1 || skip "javac not available"
  cat > src/main/java/com/x/Raw.java <<'EOF'
package com.x;
import java.util.List;
public class Raw {
    public static int f(List<String> l) {
        List raw = l;
        return raw.size();
    }
}
EOF
  load_gate
  run gate13_javac_warning_count src/main/java/com/x/Raw.java
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "AC-004-03: bare javac reports zero for a clean file" {
  command -v javac >/dev/null 2>&1 || skip "javac not available"
  cat > src/main/java/com/x/Clean.java <<'EOF'
package com.x;
import java.util.List;
public class Clean {
    public static int f(List<String> l) { return l.size(); }
}
EOF
  load_gate
  run gate13_javac_warning_count src/main/java/com/x/Clean.java
  [ "$status" -eq 0 ]
  [ "$output" -eq 0 ]
}

# ------------------------------------------------------ no Java at all

@test "REQ-004: no Java sources staged means the Java stage is a no-op PASS" {
  load_gate
  run gate13_run_java_analysis
  [ "$status" -eq "$GATE13_PASS" ]
}

@test "REQ-004: a Java project with neither mvn, gradle nor javac yields WARN" {
  cat > src/main/java/com/x/App.java <<'EOF'
package com.x;
public class App { public static void main(String[] a) {} }
EOF
  git add -A >/dev/null 2>&1
  cat > bin/mvn <<'EOF'
#!/usr/bin/env bash
exit 127
EOF
  chmod +x bin/mvn
  export PATH="$TEST_DIR/bin:$PATH"

  load_gate
  # Hide javac/gradle by pointing the gate at a PATH containing only the broken mvn.
  GATE13_FORCE_NO_JAVA_TOOLCHAIN=1 run gate13_run_java_analysis
  [ "$status" -ne "$GATE13_PASS" ]
}
