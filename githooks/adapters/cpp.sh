#!/usr/bin/env bash

run_static_analysis() {
  if command -v clang-tidy &>/dev/null; then
    find . -name "*.cpp" -o -name "*.cc" -o -name "*.c" -o -name "*.h" | head -20 | xargs clang-tidy 2>&1 | head -30
    return $?
  elif command -v cppcheck &>/dev/null; then
    cppcheck --enable=all --inline-suppr . 2>&1 | head -30
    return $?
  else
    echo "No C++ analysis tools available (clang-tidy/cppcheck)"
    return 1
  fi
}

run_lint() {
  run_static_analysis
}

run_tests() {
  if command -v cmake &>/dev/null && [ -d "build" ]; then
    cd build && ctest --output-on-failure 2>&1 | tail -20
    return $?
  elif [ -f "Makefile" ]; then
    make test 2>&1 | tail -20
    return $?
  else
    echo "No C++ test framework detected"
    return 1
  fi
}

run_coverage() {
  if command -v gcov &>/dev/null; then
    gcovr --root . 2>&1 | tail -10
    return $?
  elif command -v llvm-cov &>/dev/null; then
    llvm-cov report 2>&1 | tail -10
    return $?
  else
    echo "No C++ coverage tools available (gcovr/llvm-cov)"
    return 1
  fi
}
