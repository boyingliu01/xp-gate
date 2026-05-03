#!/usr/bin/env bash

_detect_kotlin_build() {
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
  build_system=$(_detect_kotlin_build)

  if [ "$build_system" = "maven" ]; then
    mvn compile -q 2>&1 | grep -i "error\|fail" | head -5
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "❌ Maven compilation failed"
      return 1
    fi
  elif [ "$build_system" = "gradle" ]; then
    gradle compileKotlin --quiet 2>&1 | grep -i "error\|fail" | head -5
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "❌ Gradle compilation failed"
      return 1
    fi
  fi

  if command -v ktlint &>/dev/null; then
    ktlint "**/*.kt" 2>&1 | head -20
    return $?
  elif command -v detekt &>/dev/null; then
    detekt --input . 2>&1 | head -20
    return $?
  else
    echo "No Kotlin lint tools (ktlint/detekt)"
    return 0
  fi
}

run_lint() {
  run_static_analysis
}

run_tests() {
  local build_system
  build_system=$(_detect_kotlin_build)

  if [ "$build_system" = "maven" ]; then
    mvn test -q 2>&1 | tail -15
    return ${PIPESTATUS[0]}
  elif [ "$build_system" = "gradle" ]; then
    gradle test --quiet 2>&1 | tail -15
    return ${PIPESTATUS[0]}
  else
    echo "No build system detected"
    return 1
  fi
}

run_coverage() {
  local build_system
  build_system=$(_detect_kotlin_build)

  if [ "$build_system" = "maven" ]; then
    mvn test jacoco:report -q 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  elif [ "$build_system" = "gradle" ]; then
    gradle jacocoTestReport --quiet 2>&1 | tail -10
    return ${PIPESTATUS[0]}
  else
    echo "No build system detected"
    return 1
  fi
}
