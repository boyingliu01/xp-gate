#!/usr/bin/env bats
# Java Quality Gate Tests for Pre-commit Hook
# TDD: Write tests FIRST, then implement

setup() {
  # Create temporary directory for test projects
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR

  # #593: copy the hook's WHOLE supporting tree, not just pre-commit.
  #
  # The fixture used to copy only `pre-commit`, so every case died in the first
  # lines of the hook:
  #     FATAL: cannot load hook-module-resolution.sh (module resolution order is unavailable)
  # and produced no gate output at all. All 12 assertion cases failed — in CI and
  # locally alike — while asserting nothing about the Java adapter.
  #
  # Copied as directories (`-R`) rather than file by file: pre-commit sources ten
  # helpers from lib/, and a hand-listed subset goes stale the next time one is
  # added — which is exactly how this fixture drifted.
  cp "${BATS_TEST_DIRNAME}/../pre-commit" "${TEST_DIR}/pre-commit"
  cp "${BATS_TEST_DIRNAME}/../adapter-common.sh" "${TEST_DIR}/adapter-common.sh"
  cp "${BATS_TEST_DIRNAME}/../hook-module-resolution.sh" "${TEST_DIR}/hook-module-resolution.sh"
  mkdir -p "${TEST_DIR}/lib" "${TEST_DIR}/adapters"
  cp -R "${BATS_TEST_DIRNAME}/../lib/." "${TEST_DIR}/lib/"
  cp -R "${BATS_TEST_DIRNAME}/../adapters/." "${TEST_DIR}/adapters/"
  chmod +x "${TEST_DIR}/pre-commit"

  # Initialize git repo
  cd "$TEST_DIR"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test User"
  # #593: `git init` leaves the repo on master/main, which Gate 0 treats as
  # PROTECTED and exits on:
  #     ERROR: Committing to a protected branch without VERSION/CHANGELOG update.
  # A feature branch is what a real user commits on anyway.
  git checkout --quiet -b feature/java-gate-fixture
  # #593: Gate 6 BLOCKS when neither .archlint.yaml nor architecture.yaml exists:
  #     ❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED
  # These fixtures exercise the JAVA adapter, which runs in Gate 1 — but Gate 6
  # would abort the hook first, so the Java tools the cases assert on were never
  # consulted. `.architecture-skip` is the hook's own documented exemption:
  #     ⏭️  SKIPPED - Architecture validation (.architecture-skip exemption)
  # Adding it scopes each case to the gate it is actually about.
  : > .architecture-skip
  # Keep the injected hook support tree out of the staged set, so the adapter
  # only ever sees the fixture's own project files.
  cat >> .git/info/exclude <<'EOF'
pre-commit
adapter-common.sh
hook-module-resolution.sh
.architecture-skip
lib/
adapters/
EOF
}

teardown() {
  # Clean up temporary directory
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# #593: materialise a real .java source file in the fixture.
#
# `git add .` of a pom.xml alone stages NO .java file, so Gate 1 sees "no code
# files changed" and SKIPs before the Java adapter is ever routed:
#     Gate 1: Code Quality                          SKIP
# Cases that assert on Java tooling therefore could not pass no matter what the
# adapter did. With a .java file staged the adapter runs and prints the tool
# output these cases are looking for.
add_java_source() {
  mkdir -p src/main/java/com/test
  cat > src/main/java/com/test/App.java <<'EOF'
package com.test;

/** Fixture entry point. */
public class App {
    /** Main method. */
    public static void main(String[] args) {
        System.out.println("fixture");
    }
}
EOF
}

# -----------------------------------------------------------------------------
# Test: Java project detected when pom.xml exists
# -----------------------------------------------------------------------------
@test "Java project detected when pom.xml exists" {
  # Create a minimal Maven project
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
</project>
EOF

  git add .
  
  # Run pre-commit and check it detects Java (will fail due to missing mvn, but should show Java detection)
  run ./pre-commit
  
  # Should detect Java project or show mvn/maven requirement
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"mvn"* ]] || [[ "$output" == *"Maven"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Java project detected when build.gradle exists
# -----------------------------------------------------------------------------
@test "Java project detected when build.gradle exists" {
  # Create a minimal Gradle project
  cat > build.gradle << 'EOF'
plugins {
    id 'java'
}

repositories {
    mavenCentral()
}
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should detect Java project or show gradle requirement
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Java project detected when build.gradle.kts exists
# -----------------------------------------------------------------------------
@test "Java project detected when build.gradle.kts exists" {
  # Create a minimal Gradle Kotlin project
  cat > build.gradle.kts << 'EOF'
plugins {
    java
}

repositories {
    mavenCentral()
}
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should detect Java project or show gradle requirement
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: the Java static-analysis verdict is reported for a Maven project
#
# #599: the three cases that used to live here ("CheckStyle mentioned", "PMD
# mentioned", "SpotBugs mentioned") wrote a pom.xml declaring that specific
# Maven plugin and then asserted the PLUGIN NAME appeared in the hook output.
# That never tested the adapter: the adapter does not invoke Maven lint plugins
# at all. It prefers `wc-java-lint check --staged --format json`, and only when
# that engine is absent does it fall back to bare `checkstyle` / `pmd`
# executables (githooks/adapters/java.sh run_legacy_analysis). SpotBugs is not
# an engine the adapter knows about, so "SpotBugs mentioned" could only pass by
# accident — it did locally (wc-java-lint installed, its summary text mentions
# it) and could not on a runner without it.
#
# What actually matters, and what is asserted here instead:
#   - a Maven Java project with a staged .java file reaches the Java adapter;
#   - the adapter reports a VERDICT for Java static analysis, whichever engine
#     it found; and
#   - when no engine is available it says so explicitly (WARN/ENVIRONMENT
#     ERROR) rather than silently passing.
# That holds identically whether or not wc-java-lint, checkstyle, pmd, or Maven
# are installed, so the case is no longer a lottery on the runner's toolset.
# -----------------------------------------------------------------------------
@test "Maven Java project gets a Java static-analysis verdict" {
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
</project>
EOF

  # #593: stage a real .java file so Gate 1 routes to the Java adapter.
  add_java_source
  git add .

  run ./pre-commit
  echo "$output"

  # The adapter must reach a Java static-analysis VERDICT. Assert the verdict
  # vocabulary, not the engine name: any of "clean"/PASS, a violation report, an
  # explicit no-engine WARN, or an ENVIRONMENT ERROR is a real judgment. A
  # bare mention of an engine name proves nothing — the hook prints engine
  # names in its banners too, which is exactly how a "silently PASS with no
  # engine" regression could still light up an engine-name assertion.
  local got_verdict=false
  [[ "$output" == *"wc-java-lint: clean"* ]] && got_verdict=true
  [[ "$output" == *"wc-java-lint:"*"violation"* ]] && got_verdict=true
  [[ "$output" == *"No Java static-analysis engine available"* ]] && got_verdict=true
  # wc-java-lint found on PATH but not usable (broken install, wrong arch, a
  # shadowing stub) is fail-closed by design (#507): BLOCK, not a silent pass.
  [[ "$output" == *"wc-java-lint failed with exit code"* ]] && got_verdict=true
  [[ "$output" == *"wc-java-lint unusable"* ]] && got_verdict=true
  [[ "$output" == *"ENVIRONMENT ERROR"* ]] && got_verdict=true
  [[ "$output" == *"XP_G1_REASON"* ]] && got_verdict=true
  [ "$got_verdict" = true ] || {
    echo "the Java adapter produced no static-analysis verdict at all"
    return 1
  }

  # A verdict must never be a silent clean pass while nothing was measured.
  [[ "$output" != *"✅ PASSED - no Java engine available"* ]] || {
    echo "the adapter reported a clean pass while no Java engine ran"
    return 1
  }
}

@test "Maven Java project with a lint engine configured still reaches the adapter" {
  # A pom.xml naming Maven lint plugins must not break, or short-circuit, the
  # adapter's own engine selection.
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-checkstyle-plugin</artifactId>
                <version>3.3.1</version>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-pmd-plugin</artifactId>
                <version>3.21.2</version>
            </plugin>
        </plugins>
    </build>
</project>
EOF

  add_java_source
  git add .

  run ./pre-commit
  echo "$output"

  # Same verdict-vocabulary assertion as the case above: naming the plugins in
  # pom.xml must neither break engine selection nor substitute for it.
  local got_verdict=false
  [[ "$output" == *"wc-java-lint: clean"* ]] && got_verdict=true
  [[ "$output" == *"wc-java-lint:"*"violation"* ]] && got_verdict=true
  [[ "$output" == *"No Java static-analysis engine available"* ]] && got_verdict=true
  [[ "$output" == *"wc-java-lint failed with exit code"* ]] && got_verdict=true
  [[ "$output" == *"wc-java-lint unusable"* ]] && got_verdict=true
  [[ "$output" == *"ENVIRONMENT ERROR"* ]] && got_verdict=true
  [[ "$output" == *"XP_G1_REASON"* ]] && got_verdict=true
  [ "$got_verdict" = true ] || {
    echo "the Java adapter produced no static-analysis verdict at all"
    return 1
  }
}

# -----------------------------------------------------------------------------
# Test: Gradle and Maven project detection still picks a build system
# (kept separate from engine availability: detection is adapter-local)
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Test: Tests run via Maven
# -----------------------------------------------------------------------------
@test "Tests run via Maven when test directory exists" {
  # Skip if mvn not installed
  if ! command -v mvn &> /dev/null; then
    skip "Maven not installed"
  fi
  
  # Create a Maven project with tests
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.10.0</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
EOF

  mkdir -p src/test/java/com/test
  touch src/test/java/com/test/DummyTest.java

  git add .
  
  # Run pre-commit - should attempt to run tests
  run ./pre-commit
  
  # Should mention test execution or require Maven
  [[ "$output" == *"test"* ]] || [[ "$output" == *"Test"* ]] || [[ "$output" == *"mvn"* ]] || [[ "$output" == *"Maven"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Tests run via Gradle
# -----------------------------------------------------------------------------
@test "Tests run via Gradle when test directory exists" {
  # Create a Gradle project with tests
  cat > build.gradle << 'EOF'
plugins {
    id 'java'
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
    testRuntimeOnly 'org.junit.platform:junit-platform-launcher'
}

test {
    useJUnitPlatform()
}
EOF

  mkdir -p src/test/java/com/test
  touch src/test/java/com/test/DummyTest.java

  git add .
  
  # Run pre-commit - should attempt to run tests
  run ./pre-commit
  
  # Should mention test execution or require Gradle
  [[ "$output" == *"test"* ]] || [[ "$output" == *"Test"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Java project with clean code passes static analysis detection
# -----------------------------------------------------------------------------
@test "Java project with clean code passes static analysis detection" {
  # Create a minimal Maven project
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
</project>
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should detect Java and process it (may fail on missing tools, but should process)
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"mvn"* ]] || [[ "$output" == *"Maven"* ]] || [[ "$output" == *"Gate"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Gradle Kotlin DSL project detection with settings.gradle.kts
# -----------------------------------------------------------------------------
@test "Gradle Kotlin DSL project detection with settings.gradle.kts" {
  # Create a Gradle Kotlin project with settings file
  cat > settings.gradle.kts << 'EOF'
rootProject.name = "test-project"
EOF

  cat > build.gradle.kts << 'EOF'
plugins {
    java
}

repositories {
    mavenCentral()
}
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should detect Java project or show gradle requirement
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Java language detection priority
# -----------------------------------------------------------------------------
@test "Java detection with both pom.xml and build.gradle prefers Maven" {
  # Create both Maven and Gradle files
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
</project>
EOF

  cat > build.gradle << 'EOF'
plugins {
    id 'java'
}
EOF

  git add .
  
  # Run pre-commit - should detect as Java (Maven or Gradle both work)
  run ./pre-commit
  
  # Should detect Java project (Maven should take precedence or both should work)
  [[ "$output" == *"java"* ]] || [[ "$output" == *"Java"* ]] || [[ "$output" == *"mvn"* ]] || [[ "$output" == *"Maven"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

# -----------------------------------------------------------------------------
# Test: Missing Maven tool produces environment error
# -----------------------------------------------------------------------------
@test "Missing Maven tool produces environment error" {
  # Skip if mvn is installed
  if command -v mvn &> /dev/null; then
    skip "Maven is installed, cannot test missing tool scenario"
  fi
  
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
</project>
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should fail with environment error
  [ "$status" -ne 0 ]
  [[ "$output" == *"ENVIRONMENT ERROR"* ]] || [[ "$output" == *"mvn"* ]] || [[ "$output" == *"Maven"* ]]
}

# -----------------------------------------------------------------------------
# Test: Missing Gradle tool produces environment error
# -----------------------------------------------------------------------------
@test "Missing Gradle tool produces environment error" {
  # Skip if gradle is installed
  if command -v ./gradlew &> /dev/null || command -v gradle &> /dev/null; then
    skip "Gradle is installed, cannot test missing tool scenario"
  fi
  
  cat > build.gradle << 'EOF'
plugins {
    id 'java'
}
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should fail with environment error
  [ "$status" -ne 0 ]
  [[ "$output" == *"ENVIRONMENT ERROR"* ]] || [[ "$output" == *"gradle"* ]] || [[ "$output" == *"Gradle"* ]]
}
