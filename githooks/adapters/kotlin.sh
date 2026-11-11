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

  # (#706) A failed BUILD must not swallow a lint tool that works on its own.
  #
  # This used to `return 1` the moment Gradle/Maven failed to compile, so detekt
  # -- which reads .kt sources directly and needs no build at all -- never ran.
  # Measured on a machine whose Gradle cannot resolve the Kotlin plugin
  # (`Failed to query the value of property 'buildFlowServiceProperty'`): the
  # hook reported "SKIPPED - Code quality (tools unavailable or failed)" while
  # `detekt --input .` on the same file reported two real findings. The gate
  # blamed the toolchain for a verdict the toolchain never got to deliver.
  #
  # So: record the compilation failure, still run the standalone lint tool, and
  # let the caller decide. The failure is reported, never hidden.
  local build_failed=0
  if [ "$build_system" = "maven" ]; then
    mvn compile -q 2>&1 | grep -i "error\|fail" | sed -n '1,5p; 5q'
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "❌ Maven compilation failed"
      build_failed=1
    fi
  elif [ "$build_system" = "gradle" ]; then
    gradle compileKotlin --quiet 2>&1 | grep -i "error\|fail" | sed -n '1,5p; 5q'
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "❌ Gradle compilation failed"
      build_failed=1
    fi
  fi

  # Standalone analyzers run regardless of the build outcome: their verdict does
  # not depend on the build having succeeded.
  #
  # ktlint and detekt are tried in preference order, but a tool that is PRESENT
  # and produces NOTHING is not the same as a tool that reached a verdict. An
  # `elif` chain made the first present tool authoritative: a broken ktlint (or a
  # shim on PATH, or ktlint 1.x refusing a `**/*.kt` glob) reported "No files
  # matched" and detekt -- which works -- was never consulted. Measured here:
  # `command -v ktlint` succeeded while `ktlint **/*.kt` matched zero files, so
  # the real analyzer never ran.
  local lint_rc=0 linted=0 ktlint_out=""
  if command -v ktlint &>/dev/null; then
    ktlint_out=$(ktlint "**/*.kt" 2>&1)
    lint_rc=$?
    printf '%s\n' "$ktlint_out" | sed -n '1,20p'
    # Only an EXECUTED ktlint counts as having delivered a verdict. Three ways it
    # can fail to: the binary cannot run (127/126), it reports "No files matched"
    # (ktlint 1.8.0 no longer resolves `**/*.kt`), or it printed nothing at all.
    # In every one of those cases detekt should speak instead of ktlint's silence
    # being read as "clean".
    if [ "$lint_rc" -ne 127 ] && [ "$lint_rc" -ne 126 ] \
       && [ -n "$ktlint_out" ] \
       && ! printf '%s\n' "$ktlint_out" | grep -q 'No files matched'; then
      linted=1
    fi
  fi
  if [ "$linted" -eq 0 ] && command -v detekt &>/dev/null; then
    detekt --input . 2>&1 | sed -n '1,20p; 20q'
    lint_rc=${PIPESTATUS[0]}
    linted=1
  fi
  if [ "$linted" -eq 0 ]; then
    echo "No Kotlin lint tools (ktlint/detekt)"
    # A missing lint tool is a SKIP, not a pass -- but it must not manufacture a
    # failure either. Only the build result decides in that case.
    [ "$build_failed" -eq 0 ] && return 0
    return 1
  fi

  # A lint finding is a finding whether or not the build also failed.
  [ "$lint_rc" -ne 0 ] && return "$lint_rc"
  return "$build_failed"
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

# #798 / #794: run_coverage() below re-runs the test phase itself (`mvn test` /
# `gradle jacocoTestReport` both execute the suite), so a separate run_tests()
# pass adds no verdict -- only time. Undeclared adapters keep the double-run
# default, which is slower but never skips test verification.
coverage_runs_tests() { return 0; }

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
