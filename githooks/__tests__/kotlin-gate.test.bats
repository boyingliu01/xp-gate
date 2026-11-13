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

  # (#706) The hook loads its own modules from ITS OWN directory, so the fixture
  # needs them next to the copy or it dies before any gate runs:
  #     FATAL: cannot load hook-module-resolution.sh
  #     FATAL: cannot load .git/hooks/lib/now-ms.sh (missing)
  # Every other suite that runs the real hook copies these (gate-5a-block,
  # gate-m2-threshold, gate9-architecture, gate-cjs-source-detection); this one
  # did not, and the gap only surfaced on a machine with detekt installed —
  # on CI the affected case is skipped, so it never went red there.
  #
  # Copy the WHOLE lib/ directory, not a list of names: pre-commit sources ten
  # helpers and listing them by name is exactly what let gate9-architecture.bats
  # drift nine helpers behind (#592).
  cp "${BATS_TEST_DIRNAME}/../hook-module-resolution.sh" .git/hooks/hook-module-resolution.sh
  mkdir -p .git/hooks/lib
  cp -R "${BATS_TEST_DIRNAME}/../lib/." .git/hooks/lib/
  # adapter-common.sh is the one file the list above still omitted. It stayed
  # invisible while detekt was absent: the affected cases skipped themselves, so
  # nobody ever saw "Error: Cannot source adapter-common.sh from .../.git/hooks".
  # Once the BATS job started installing detekt the cases RAN and failed on the
  # missing dependency -- i.e. on this fixture, not on the behaviour under test.
  cp "${BATS_TEST_DIRNAME}/../adapter-common.sh" .git/hooks/adapter-common.sh
  # #798: pre-commit is an entry point now -- it sources gate-driver.sh and one
  # body per gate from gate-entries/. Without them the copied hook prints its
  # banner and stops, so the detekt findings this suite asserts on never appear
  # and the case reads as "detekt reported nothing" when detekt never ran.
  cp "${BATS_TEST_DIRNAME}/../gate-driver.sh" .git/hooks/gate-driver.sh
  cp "${BATS_TEST_DIRNAME}/../gate-registry.sh" .git/hooks/gate-registry.sh 2>/dev/null || true
  cp -R "${BATS_TEST_DIRNAME}/../gate-entries" .git/hooks/gate-entries
}

teardown() {
  # Clean up test directory
  cd "$BATS_TEST_DIRNAME" || return 1
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
  #
  # SKIP_VERSION_CHECK=1 because this fixture stages a .kt file and nothing else.
  # It did not need this until Gate 0 learned that .kt is source (it used to call a
  # Kotlin-only change "doc-only" and skip the entire rest of the chain), after
  # which Gate 0 correctly demanded a VERSION bump and blocked before Gate 1 ran.
  # The subject here is detekt's verdict, not the version rules, so the version
  # gate is declared out of scope -- the same way gate-5a-block and
  # gate-cjs-source-detection already do it.
  run env SKIP_VERSION_CHECK=1 .git/hooks/pre-commit

  [ "$status" -ne 0 ]

  # (#706) 断言原本是 `*"detekt"*` 或 `*"Commit blocked"*`，在装了 detekt 的机器上
  # 永远不成立：一行输出里既没有 "detekt" 这个词（detekt 打印的是它的发现内容，
  # 例如 "[MagicNumber] ... magic number"），也没有 "Commit blocked"（拦下提交的
  # 是 Gate 5 的 "Tests FAILED"，因为本机 Gradle 解析不到 Kotlin 插件）。
  #
  # 这条断言真正应该钉住的是：**detekt 作为独立分析器是否真的给出了判定**。
  # 修复前它在 Gradle 编译失败时提前 return，detekt 一次都没被调用，所以断言
  # 失败是对的；修复后 detekt 一定运行，其发现必须出现在输出里。
  #
  # 断言 detekt 的发现内容（而不是它的名字）也顺带排除了「只打印了工具名却没
  # 真的检查」这种假通过。MagicNumber 是该夹具里最稳定的发现。
  [[ "$output" == *"MagicNumber"* ]] || [[ "$output" == *"magic number"* ]] || [[ "$output" == *"Commit blocked"* ]]
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
  #
  # detekt is given the DIRECTORY, not the newline-joined `git diff` output.
  # `--input "$CHANGED_FILES"` put every staged path inside one argument, which
  # jcommander rejects outright:
  #   ParameterException: Provided path 'GoodCode.kt\n...'
  # so this case failed on a malformed command line and reported it as "detekt
  # found violations". Passing `.` also matches what the adapter itself does.
  run bash -c '
    if command -v detekt &> /dev/null; then
      detekt --input . 2>&1 | head -30
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
