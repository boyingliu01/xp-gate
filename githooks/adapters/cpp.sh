#!/usr/bin/env bash

_detect_cpp_build() {
  if command -v cmake &>/dev/null && [ -f "CMakeLists.txt" ]; then
    echo "cmake"
  elif [ -f "Makefile" ]; then
    echo "make"
  else
    echo "none"
  fi
}

run_static_analysis() {
  if command -v clang-tidy &>/dev/null; then
    local files
    files=$(find . -name "*.cpp" -o -name "*.cc" -o -name "*.c" -o -name "*.h" 2>/dev/null | head -20)
    if [ -n "$files" ]; then
      echo "$files" | xargs clang-tidy 2>&1 | head -20
    fi
  elif command -v cppcheck &>/dev/null; then
    cppcheck --enable=all --inline-suppr . 2>&1 | head -20
  else
    echo "No C++ analysis tools (clang-tidy/cppcheck)"
    return 1
  fi
  return 0
}

run_lint() {
  run_static_analysis
}

run_tests() {
  local build_system
  build_system=$(_detect_cpp_build)

  if [ "$build_system" = "cmake" ]; then
    if [ -d "build" ]; then
      cmake --build build/ 2>&1 | tail -5
      cd build && ctest --output-on-failure 2>&1 | tail -15
      return ${PIPESTATUS[1]}
    else
      cmake -B build -G Ninja 2>/dev/null || cmake -B build 2>/dev/null
      cmake --build build/ 2>&1 | tail -5
      cd build && ctest --output-on-failure 2>&1 | tail -15
      return ${PIPESTATUS[1]}
    fi
  elif [ "$build_system" = "make" ]; then
    make 2>&1 | tail -5
    make test 2>&1 | tail -15
    return ${PIPESTATUS[1]}
  else
    echo "No C++ build system detected"
    return 1
  fi
}

run_coverage() {
  local build_system
  build_system=$(_detect_cpp_build)

  if command -v gcovr &>/dev/null; then
    if [ "$build_system" = "cmake" ] && [ -d "build" ]; then
      cd build && gcovr --root .. 2>&1 | tail -10
      return $?
    fi
    gcovr --root . 2>&1 | tail -10
    return $?
  elif command -v llvm-cov &>/dev/null; then
    llvm-cov report 2>&1 | tail -10
    return $?
  else
    echo "No C++ coverage tools (gcovr/llvm-cov)"
    return 1
  fi
}
