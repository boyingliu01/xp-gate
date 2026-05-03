#!/usr/bin/env bash

run_static_analysis() {
  local has_tool=false
  if command -v checkstyle &>/dev/null; then
    echo "Running CheckStyle..."
    checkstyle -c /google_checks.xml . 2>&1 | head -30 || true
    has_tool=true
  fi
  if command -v pmd &>/dev/null; then
    echo "Running PMD..."
    pmd check -d . -R category/java/errorprone.xml 2>&1 | head -30 || true
    has_tool=true
  fi
  if [ "$has_tool" = false ]; then
    echo "No Java analysis tools available (checkstyle/pmd)"
    return 1
  fi
  return 0
}

run_lint() {
  run_static_analysis
}

run_tests() {
  if [ -f "pom.xml" ]; then
    echo "Running Maven tests..."
    mvn test 2>&1 | tail -20
    return ${PIPESTATUS[0]}
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "Running Gradle tests..."
    gradle test 2>&1 | tail -20
    return ${PIPESTATUS[0]}
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}

run_coverage() {
  if [ -f "pom.xml" ]; then
    echo "Running Maven coverage..."
    mvn test jacoco:report 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "Running Gradle coverage..."
    gradle jacocoTestReport 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  else
    echo "No Maven/Gradle project detected"
    return 1
  fi
}
