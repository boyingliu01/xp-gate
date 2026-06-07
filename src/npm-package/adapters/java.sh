#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Plugin directory
PLUGIN_DIR="$SCRIPT_DIR/plugins/p3c-java"
WHALECLOUD_PLUGIN_DIR="$SCRIPT_DIR/plugins/whalecloud-java"

_is_whalecloud_enabled() {
  # Check if whalecloud-java plugin is enabled
  [ -d "$WHALECLOUD_PLUGIN_DIR" ] && \
    ([ -f "config/pmd/whalecloud-ruleset.xml" ] || \
     grep -q 'xp-gate-whalecloud-java\|xpGateWhalecloudCheck' pom.xml build.gradle build.gradle.kts 2>/dev/null)
}

_detect_java_build() {
  if [ -f "pom.xml" ]; then
    echo "maven"
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "gradle"
  else
    echo "none"
  fi
}

run_static_analysis() {
  local build_system
  build_system=$(_detect_java_build)

  if [ "$build_system" = "maven" ]; then
    mvn compile -q 2>&1 | grep -i "error\|fail" | head -5
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then
      echo "❌ Maven compilation failed"
      return 1
    fi
  elif [ "$build_system" = "gradle" ]; then
    gradle compileJava --quiet 2>&1 | grep -i "error\|fail" | head -5
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then
      echo "❌ Gradle compilation failed"
      return 1
    fi
  fi

  # CheckStyle with Google style (legacy fallback)
  if command -v checkstyle &>/dev/null; then
    checkstyle -c /google_checks.xml . 2>&1 | head -20
  fi

  # PMD error detection (legacy fallback)
  if command -v pmd &>/dev/null; then
    pmd check -d . -R category/java/errorprone.xml 2>&1 | head -20
  fi

  # p3c-pmd check (Alibaba coding guidelines) — primary Java quality gate
  _run_p3c_check "$build_system"

  # WhaleCloud Java Coding Standards — overlay on top of p3c-pmd
  _run_whalecloud_check "$build_system"

  return 0
}

run_lint() {
  run_static_analysis
}

run_tests() {
  local build_system
  build_system=$(_detect_java_build)

  if [ "$build_system" = "maven" ]; then
    mvn test -q 2>&1 | tail -15
    return "${PIPESTATUS[0]}"
  elif [ "$build_system" = "gradle" ]; then
    gradle test --quiet 2>&1 | tail -15
    return "${PIPESTATUS[0]}"
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}

run_coverage() {
  local build_system
  build_system=$(_detect_java_build)

  if [ "$build_system" = "maven" ]; then
    mvn test jacoco:report -q 2>&1 | tail -10
    return "${PIPESTATUS[0]}"
  elif [ "$build_system" = "gradle" ]; then
    gradle jacocoTestReport --quiet 2>&1 | tail -10
    return "${PIPESTATUS[0]}"
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}

run_p3c_check() {
  _run_p3c_check "$(_detect_java_build)"
}

_run_p3c_check() {
  local build_system="$1"

  echo "  Running p3c-pmd Alibaba Coding Guidelines check..."

  if [ "$build_system" = "maven" ]; then
    if grep -q '<id>xp-gate-p3c</id>' pom.xml 2>/dev/null; then
      # Profile already installed — use it
      mvn pmd:check -P xp-gate-p3c -Dpmd.failOnViolation=true 2>&1 | tail -30
      return "${PIPESTATUS[0]}"
    else
      # Profile not installed — run inline with p3c-pmd dependency
      if command -v mvn &>/dev/null; then
        mvn pmd:check \
          -Dpmd.rulesets="/rulesets/java/ali-comment.xml,/rulesets/java/ali-concurrent.xml,/rulesets/java/ali-constant.xml,/rulesets/java/ali-exception.xml,/rulesets/java/ali-flowcontrol.xml,/rulesets/java/ali-naming.xml,/rulesets/java/ali-oop.xml,/rulesets/java/ali-orm.xml,/rulesets/java/ali-other.xml,/rulesets/java/ali-set.xml" \
          -Dpmd.failOnViolation=true \
          -DprintFailingErrors=true \
          2>&1 | tail -30
        local result="${PIPESTATUS[0]}"

        if [ "$result" -ne 0 ]; then
          echo ""
          echo "  ⚠️  p3c-pmd check FAILED — Alibaba Coding Guidelines violations found"
          echo "  To permanently enable: bash $PLUGIN_DIR/scripts/install-maven-p3c.sh"
          return 1
        fi

        echo "  ✅ p3c-pmd check passed"
        return 0
      else
        echo "  ℹ️  Maven not available — Skipping p3c-pmd"
        return 0
      fi
    fi

  elif [ "$build_system" = "gradle" ]; then
    if grep -q 'xp-gateP3cCheck\|p3c-pmd' build.gradle 2>/dev/null || \
       grep -q 'xp-gateP3cCheck\|p3c-pmd' build.gradle.kts 2>/dev/null; then
      gradle xp-gateP3cCheck --quiet 2>&1 | tail -20
      return "${PIPESTATUS[0]}"
    else
      echo "  ℹ️  p3c-pmd not configured in Gradle build"
      echo "  To enable: bash $PLUGIN_DIR/scripts/install-gradle-p3c.sh"
      return 0
    fi
  fi

  echo "  ℹ️  No Maven/Gradle project — Skipping p3c-pmd"
  return 0
}

_run_whalecloud_check() {
  local build_system="$1"

  if ! _is_whalecloud_enabled; then
    return 0
  fi

  echo "  Running WhaleCloud Java Coding Standards check..."

  if [ "$build_system" = "maven" ]; then
    if grep -q '<id>xp-gate-whalecloud-java</id>' pom.xml 2>/dev/null; then
      mvn pmd:check checkstyle:check spotbugs:check \
        -P xp-gate-whalecloud-java -Dpmd.failOnViolation=true \
        2>&1 | tail -30
      return "${PIPESTATUS[0]}"
    else
      echo "  ⚠️  whalecloud-java profile not installed in pom.xml"
      echo "  To enable: bash $WHALECLOUD_PLUGIN_DIR/scripts/install-maven-whalecloud.sh"
      return 0
    fi

  elif [ "$build_system" = "gradle" ]; then
    if grep -q 'xp-gateWhalecloudCheck' build.gradle 2>/dev/null || \
       grep -q 'xp-gateWhalecloudCheck' build.gradle.kts 2>/dev/null; then
      gradle xp-gateWhalecloudCheck --quiet 2>&1 | tail -20
      return "${PIPESTATUS[0]}"
    else
      echo "  ⚠️  whalecloud-java not configured in Gradle build"
      echo "  To enable: bash $WHALECLOUD_PLUGIN_DIR/scripts/install-gradle-whalecloud.sh"
      return 0
    fi
  fi

  return 0
}

run_whalecloud_check() {
  _run_whalecloud_check "$(_detect_java_build)"
}
