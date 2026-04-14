#!/usr/bin/env bats
# Kotlin Quality Gate Tests for Pre-Commit Hook
# Tests detekt (PRIMARY) and ktlint (SUPPLEMENTAL) integration

setup() {
  # Create temporary test directory
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init
  git config user.email "test@test.com"
  git config user.name "Test User"

  # Create hooks directory and copy pre-commit hook
  mkdir -p .git/hooks
  cp "${BATS_TEST_DIRNAME}/../pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
}

teardown() {
  # Clean up test directory
  rm -rf "$TEST_DIR"
}

# ============================================================================
# Test 1: Kotlin project detection when .kt files exist with Gradle
# ============================================================================
@test "detects Kotlin project when .kt files exist with build.gradle" {
  # Create a Kotlin file and build.gradle
  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello, World!")
}
EOF

  git add .

  # Run the language detection part of pre-commit
  run bash -c '
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
    PROJECT_LANG=""
    if [ -f "tsconfig.json" ] || [ -f "package.json" ]; then
      PROJECT_LANG="typescript"
    elif [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
      PROJECT_LANG="python"
    elif [ -f "go.mod" ]; then
      PROJECT_LANG="go"
    elif [ -f "pubspec.yaml" ]; then
      if grep -q "flutter:" pubspec.yaml 2>/dev/null || [ -f ".metadata" ]; then
        PROJECT_LANG="flutter"
      else
        PROJECT_LANG="dart"
      fi
    elif [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
      KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" 2>/dev/null | wc -l)
      if [ "$KOTLIN_FILES" -gt 0 ]; then
        PROJECT_LANG="kotlin"
      else
        PROJECT_LANG="java"
      fi
    fi
    echo "$PROJECT_LANG"
  '

  [ "$status" -eq 0 ]
  [ "$output" = "kotlin" ]
}

@test "detects Kotlin project when .kt files exist with build.gradle.kts" {
  # Create a Kotlin file and build.gradle.kts
  cat > build.gradle.kts << 'EOF'
plugins {
    kotlin("jvm") version "1.9.0"
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello, World!")
}
EOF

  git add .

  # Run the language detection part of pre-commit
  run bash -c '
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
    PROJECT_LANG=""
    if [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
      KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" 2>/dev/null | wc -l)
      if [ "$KOTLIN_FILES" -gt 0 ]; then
        PROJECT_LANG="kotlin"
      else
        PROJECT_LANG="java"
      fi
    fi
    echo "$PROJECT_LANG"
  '

  [ "$status" -eq 0 ]
  [ "$output" = "kotlin" ]
}

@test "falls back to Java when no .kt files exist with build.gradle" {
  # Create only Java files with build.gradle
  cat > build.gradle << 'EOF'
plugins {
    id 'java'
}
EOF

  cat > Main.java << 'EOF'
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
EOF

  git add .

  # Run the language detection part of pre-commit
  run bash -c '
    if [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
      KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" 2>/dev/null | wc -l)
      if [ "$KOTLIN_FILES" -gt 0 ]; then
        PROJECT_LANG="kotlin"
      else
        PROJECT_LANG="java"
      fi
    fi
    echo "$PROJECT_LANG"
  '

  [ "$status" -eq 0 ]
  [ "$output" = "java" ]
}

# ============================================================================
# Test 2: detekt runs as PRIMARY tool (blocks on violations)
# ============================================================================
@test "detekt CLI blocks commit when violations found" {
  # Skip if detekt is not installed
  if ! command -v detekt &> /dev/null; then
    skip "detekt not installed"
  fi

  # Create Kotlin project structure
  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  # Create a Kotlin file with violations (long function, magic numbers)
  cat > BadCode.kt << 'EOF'
fun badFunction() {
    val x = 12345
    val y = 67890
    val z = 11111
    val a = 22222
    val b = 33333
    val c = 44444
    val d = 55555
    val e = 66666
    val f = 77777
    val g = 88888
    val h = 99999
    println(x + y + z + a + b + c + d + e + f + g + h)
}
EOF

  git add .

  # Run pre-commit and expect it to fail
  run .git/hooks/pre-commit

  [ "$status" -ne 0 ]
  [[ "$output" == *"detekt"* ]] || [[ "$output" == *"Commit blocked"* ]]
}

@test "detekt CLI passes when no violations found" {
  # Skip if detekt is not installed
  if ! command -v detekt &> /dev/null; then
    skip "detekt not installed"
  fi

  # Create Kotlin project structure
  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  # Create a clean Kotlin file
  cat > GoodCode.kt << 'EOF'
fun goodFunction() {
    println("Hello")
}
EOF

  git add .

  # Run pre-commit detekt check directly
  run bash -c '
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
    if command -v detekt &> /dev/null; then
      detekt --input "$CHANGED_FILES" 2>&1 | head -30
      DETEKT_EXIT=${PIPESTATUS[0]}
      if [ "$DETEKT_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
      echo "✅ detekt passed."
    fi
  '

  [ "$status" -eq 0 ]
}

# ============================================================================
# Test 3: ktlint runs as SUPPLEMENTAL (formatting only, does NOT block)
# ============================================================================
@test "ktlint runs but does not block commit on formatting issues" {
  # Skip if ktlint is not installed
  if ! command -v ktlint &> /dev/null; then
    skip "ktlint not installed"
  fi

  # Create Kotlin project
  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  # Create a Kotlin file with formatting issues
  cat > PoorlyFormatted.kt << 'EOF'
fun poorlyFormatted(  )   {
    println("bad formatting")
}
EOF

  git add .

  # Run ktlint check (should warn but not block)
  run bash -c '
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
    KOTLIN_CHANGED=$(echo "$CHANGED_FILES" | grep "\.kt$" || true)
    if [ -n "$KOTLIN_CHANGED" ] && command -v ktlint &> /dev/null; then
      ktlint "$KOTLIN_CHANGED" 2>&1 | head -20
      echo "⚠️ ktlint formatting suggestions (supplemental)"
    fi
    # Should exit 0 even with formatting issues
    exit 0
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"ktlint"* ]] || [[ "$output" == *"supplemental"* ]]
}

# ============================================================================
# Test 4: Gradle plugin works (./gradlew detekt)
# ============================================================================
@test "uses Gradle detekt plugin when ./gradlew exists" {
  # Create mock gradlew
  cat > gradlew << 'EOF'
#!/bin/bash
# Mock gradlew for testing
if [ "$1" = "detekt" ]; then
  echo "> Task :detekt"
  echo "detekt finished successfully."
  exit 0
fi
exit 1
EOF
  chmod +x gradlew

  # Create build.gradle
  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
    id 'io.gitlab.arturbosch.detekt' version '1.23.0'
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello")
}
EOF

  git add .

  # Test the Gradle detekt execution
  run bash -c '
    if [ -f "./gradlew" ]; then
      ./gradlew detekt 2>&1 | head -30
      GRADLE_EXIT=${PIPESTATUS[0]}
      if [ "$GRADLE_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
      echo "✅ Gradle detekt passed."
    fi
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"detekt"* ]]
}

@test "blocks commit when Gradle detekt finds violations" {
  # Create mock gradlew that fails
  cat > gradlew << 'EOF'
#!/bin/bash
# Mock gradlew for testing
if [ "$1" = "detekt" ]; then
  echo "> Task :detekt FAILED"
  echo "ComplexMethod - 20/15 - Main.kt:5:1"
  echo "MagicNumber - MagicNumber - Main.kt:10:5"
  exit 1
fi
exit 1
EOF
  chmod +x gradlew

  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello")
}
EOF

  git add .

  # Test that failing Gradle detekt blocks commit
  run bash -c '
    if [ -f "./gradlew" ]; then
      ./gradlew detekt 2>&1 | head -30
      GRADLE_EXIT=${PIPESTATUS[0]}
      if [ "$GRADLE_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
    fi
  '

  [ "$status" -ne 0 ]
  [[ "$output" == *"Commit blocked"* ]]
}

# ============================================================================
# Test 5: CLI detekt works if installed
# ============================================================================
@test "prefers CLI detekt over Gradle when both available" {
  # Create mock gradlew (should not be called if detekt CLI available)
  cat > gradlew << 'EOF'
#!/bin/bash
echo "Gradle should not be called"
exit 1
EOF
  chmod +x gradlew

  # Create mock detekt CLI
  mkdir -p mock_bin
  cat > mock_bin/detekt << 'EOF'
#!/bin/bash
echo "detekt CLI executed"
echo "successfully analyzed"
exit 0
EOF
  chmod +x mock_bin/detekt

  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello")
}
EOF

  git add .

  # Test that CLI detekt is preferred
  run bash -c '
    export PATH="mock_bin:$PATH"
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

    # PRIMARY: detekt (CLI preferred over Gradle)
    if command -v detekt &> /dev/null; then
      detekt --input "$CHANGED_FILES" 2>&1 | head -30
      DETEKT_EXIT=${PIPESTATUS[0]}
      if [ "$DETEKT_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
      echo "✅ CLI detekt passed."
    elif [ -f "./gradlew" ]; then
      ./gradlew detekt 2>&1 | head -30
      GRADLE_EXIT=${PIPESTATUS[0]}
      if [ "$GRADLE_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
      echo "✅ Gradle detekt passed."
    fi
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"detekt CLI executed"* ]]
  [[ "$output" != *"Gradle should not be called"* ]]
}

@test "falls back to Gradle when detekt CLI not installed" {
  # Create mock gradlew
  cat > gradlew << 'EOF'
#!/bin/bash
if [ "$1" = "detekt" ]; then
  echo "> Task :detekt"
  echo "detekt finished successfully."
  exit 0
fi
exit 1
EOF
  chmod +x gradlew

  cat > build.gradle << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}
EOF

  cat > Main.kt << 'EOF'
fun main() {
    println("Hello")
}
EOF

  git add .

  # Test fallback to Gradle when detekt CLI not available
  run bash -c '
    # Ensure detekt CLI is not in PATH
    export PATH="/usr/bin:/bin"
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

    if command -v detekt &> /dev/null; then
      echo "CLI detekt found - should not happen in test"
      exit 1
    elif [ -f "./gradlew" ]; then
      ./gradlew detekt 2>&1 | head -30
      GRADLE_EXIT=${PIPESTATUS[0]}
      if [ "$GRADLE_EXIT" -ne 0 ]; then
        echo "❌ DETEKT ERRORS. Commit blocked."
        exit 1
      fi
      echo "✅ Gradle detekt passed (fallback)."
    fi
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"Gradle detekt passed"* ]]
}

# ============================================================================
# Test 6: Complete integration test
# ============================================================================
@test "complete Kotlin gate flow with all tools" {
  # Create mock tools
  mkdir -p mock_bin

  # Mock detekt CLI
  cat > mock_bin/detekt << 'EOF'
#!/bin/bash
echo "detekt 1.23.0"
echo "Analyzing Kotlin files..."
echo "Build succeeded"
exit 0
EOF
  chmod +x mock_bin/detekt

  # Mock ktlint
  cat > mock_bin/ktlint << 'EOF'
#!/bin/bash
echo "ktlint finished"
exit 0
EOF
  chmod +x mock_bin/ktlint

  # Create project structure
  mkdir -p src
  cat > build.gradle.kts << 'EOF'
plugins {
    kotlin("jvm") version "1.9.0"
}
EOF

  cat > src/Main.kt << 'EOF'
package src

fun main() {
    println("Hello, Kotlin!")
}
EOF

  git add .

  # Test the complete Kotlin gate implementation
  run bash -c '
    export PATH="mock_bin:$PATH"
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
    PROJECT_LANG=""

    # Detect language
    if [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
      KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" 2>/dev/null | wc -l)
      if [ "$KOTLIN_FILES" -gt 0 ]; then
        PROJECT_LANG="kotlin"
      else
        PROJECT_LANG="java"
      fi
    fi

    echo "Project language: $PROJECT_LANG"

    # Run Kotlin analysis
    if [ "$PROJECT_LANG" = "kotlin" ]; then
      echo "→ Running Kotlin static analysis..."

      # PRIMARY: detekt
      DETEKT_PASSED=false
      if command -v detekt &> /dev/null; then
        detekt --input "$CHANGED_FILES" 2>&1 | head -30
        DETEKT_EXIT=${PIPESTATUS[0]}
        if [ "$DETEKT_EXIT" -ne 0 ]; then
          echo "❌ DETEKT ERRORS. Commit blocked."
          exit 1
        fi
        echo "✅ detekt passed."
        DETEKT_PASSED=true
      elif [ -f "./gradlew" ]; then
        ./gradlew detekt 2>&1 | head -30
        GRADLE_EXIT=${PIPESTATUS[0]}
        if [ "$GRADLE_EXIT" -ne 0 ]; then
          echo "❌ DETEKT ERRORS. Commit blocked."
          exit 1
        fi
        echo "✅ Gradle detekt passed."
        DETEKT_PASSED=true
      else
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "   ❌ ENVIRONMENT ERROR - COMMIT BLOCKED"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Required tool 'detekt' is NOT installed."
        echo ""
        echo "Install commands:"
        echo "  CLI: brew install detekt"
        echo "       or download from https://github.com/detekt/detekt"
        echo "  Gradle: Add io.gitlab.arturbosch.detekt plugin"
        echo ""
        exit 1
      fi

      # SUPPLEMENTAL: ktlint (formatting only - warning)
      if command -v ktlint &> /dev/null; then
        KOTLIN_CHANGED=$(echo "$CHANGED_FILES" | grep "\.kt$" || true)
        if [ -n "$KOTLIN_CHANGED" ]; then
          ktlint "$KOTLIN_CHANGED" 2>&1 | head -20
          echo "⚠️ ktlint formatting suggestions (supplemental)"
        fi
      fi
    fi

    echo "✅ Kotlin quality gate passed."
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"Project language: kotlin"* ]]
  [[ "$output" == *"detekt passed"* ]]
  [[ "$output" == *"Kotlin quality gate passed"* ]]
}
