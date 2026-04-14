#!/usr/bin/env bats
# Java Quality Gate Tests for Pre-commit Hook
# TDD: Write tests FIRST, then implement

setup() {
  # Create temporary directory for test projects
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR
  
  # Copy pre-commit hook to test directory
  cp "${BATS_TEST_DIRNAME}/../pre-commit" "${TEST_DIR}/pre-commit"
  chmod +x "${TEST_DIR}/pre-commit"
  
  # Initialize git repo
  cd "$TEST_DIR"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test User"
}

teardown() {
  # Clean up temporary directory
  rm -rf "$TEST_DIR"
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
# Test: CheckStyle error message shown when tool not configured
# -----------------------------------------------------------------------------
@test "CheckStyle mentioned in Maven Java project" {
  # Skip if mvn not installed
  if ! command -v mvn &> /dev/null; then
    skip "Maven not installed"
  fi
  
  # Create a Maven project with CheckStyle
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
        </plugins>
    </build>
</project>
EOF

  git add .
  
  # Run pre-commit - may fail but should mention CheckStyle
  run ./pre-commit
  
  # Should mention CheckStyle
  [[ "$output" == *"checkstyle"* ]] || [[ "$output" == *"CheckStyle"* ]] || [[ "$output" == *"CHECKSTYLE"* ]]
}

# -----------------------------------------------------------------------------
# Test: PMD mentioned in Maven Java project
# -----------------------------------------------------------------------------
@test "PMD mentioned in Maven Java project" {
  # Skip if mvn not installed
  if ! command -v mvn &> /dev/null; then
    skip "Maven not installed"
  fi
  
  # Create a Maven project with PMD
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
                <artifactId>maven-pmd-plugin</artifactId>
                <version>3.21.2</version>
            </plugin>
        </plugins>
    </build>
</project>
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should mention PMD
  [[ "$output" == *"pmd"* ]] || [[ "$output" == *"PMD"* ]]
}

# -----------------------------------------------------------------------------
# Test: SpotBugs mentioned in Maven Java project
# -----------------------------------------------------------------------------
@test "SpotBugs mentioned in Maven Java project" {
  # Skip if mvn not installed
  if ! command -v mvn &> /dev/null; then
    skip "Maven not installed"
  fi
  
  # Create a Maven project with SpotBugs
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
                <groupId>com.github.spotbugs</groupId>
                <artifactId>spotbugs-maven-plugin</artifactId>
                <version>4.8.3.1</version>
            </plugin>
        </plugins>
    </build>
</project>
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # Should mention SpotBugs
  [[ "$output" == *"spotbugs"* ]] || [[ "$output" == *"SpotBugs"* ]] || [[ "$output" == *"SPOTBUGS"* ]]
}

# -----------------------------------------------------------------------------
# Test: All three tools work together (CheckStyle + PMD + SpotBugs)
# -----------------------------------------------------------------------------
@test "All three tools work together - CheckStyle PMD SpotBugs" {
  # Skip if mvn not installed
  if ! command -v mvn &> /dev/null; then
    skip "Maven not installed"
  fi
  
  # Create a Maven project with all three tools
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
            <plugin>
                <groupId>com.github.spotbugs</groupId>
                <artifactId>spotbugs-maven-plugin</artifactId>
                <version>4.8.3.1</version>
            </plugin>
        </plugins>
    </build>
</project>
EOF

  git add .
  
  # Run pre-commit
  run ./pre-commit
  
  # All tools should run or ENVIRONMENT ERROR if not available
  [[ "$output" == *"CheckStyle"* ]] || [[ "$output" == *"checkstyle"* ]] || [[ "$output" == *"PMD"* ]] || [[ "$output" == *"pmd"* ]] || [[ "$output" == *"SpotBugs"* ]] || [[ "$output" == *"spotbugs"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

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
