#!/usr/bin/env bash

run_static_analysis() {
  if command -v ktlint &>/dev/null; then
    ktlint "**/*.kt" 2>&1 | head -30
    return $?
  elif command -v detekt &>/dev/null; then
    detekt --input . 2>&1 | head -30
    return $?
  else
    echo "No Kotlin analysis tools available (ktlint/detekt)"
    return 1
  fi
}

run_lint() {
  run_static_analysis
}

run_tests() {
  if [ -f "pom.xml" ]; then
    mvn test 2>&1 | tail -20
    return ${PIPESTATUS[0]}
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    gradle test 2>&1 | tail -20
    return ${PIPESTATUS[0]}
  else
    echo "No build system detected"
    return 1
  fi
}

run_coverage() {
  if [ -f "pom.xml" ]; then
    mvn test jacoco:report 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    gradle jacocoTestReport 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  else
    echo "No build system detected"
    return 1
  fi
}
