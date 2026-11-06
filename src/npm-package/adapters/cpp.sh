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

# verdict codes consumed by Gate 1 (#776):
#   0 = clean   1 = ran and found diagnostics   2 = could not execute (fail-closed)
#
# The old body piped the analyzer into `sed` and then returned 0 unconditionally,
# so clang-tidy/cppcheck findings were *displayed and discarded*. Both tools exit
# non-zero when they have anything to report, which made that the only possible
# answer: a C/C++ project had no working Gate 1 at all, no matter what the hook
# did with the verdict. Hence: capture into a variable, keep the status, and use
# 2 -- not 1 -- for "no tooling", because "I could not run anything" must not be
# indistinguishable from "I ran it and it was clean".
run_static_analysis() {
  local files out rc db

  if command -v clang-tidy &>/dev/null; then
    # Parentheses around the -o chain: without them `2>/dev/null` binds only to
    # the last predicate and find still prints "No such file" noise for the rest.
    files=$(find . \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' -o -name '*.c' -o -name '*.h' -o -name '*.hpp' \) \
      -not -path './.git/*' -not -path './build/*' 2>/dev/null | head -20)
    if [ -z "$files" ]; then
      echo "No C/C++ sources to analyse"
      return 2
    fi
    # clang-tidy needs a compilation database to know the include paths, and it
    # needs an explicit check set or it aborts with "no checks enabled" + usage.
    # Both failure modes exit non-zero on a CLEAN tree, which under the fixed
    # gate would be a false BLOCK rather than a false pass. Detect "the tool
    # refused to run" and hand the job to cppcheck, which needs no database.
    db=""
    for candidate in compile_commands.json build/compile_commands.json; do
      if [ -f "$candidate" ]; then db="$candidate"; break; fi
    done
    if [ -n "$db" ]; then
      out=$(printf '%s\n' "$files" | xargs clang-tidy -p "$(dirname "$db")" 2>&1)
      rc=$?
    else
      # No database: a fixed, conservative check set beats clang-tidy's defaults
      # (which are empty). `bugprone-*` + `clang-analyzer-*` are the tiers that
      # catch the same class of defect as a compiler with -Wall -Wextra without
      # demanding a style config the project never agreed to.
      out=$(printf '%s\n' "$files" | xargs clang-tidy \
        --checks='-*,bugprone-*,clang-analyzer-*' -- 2>&1)
      rc=$?
    fi
    printf '%s\n' "$out" | head -20
    if printf '%s\n' "$out" | grep -q 'no compilation database\|No compilation database\|no checks enabled\|USAGE: clang-tidy'; then
      echo "clang-tidy could not establish a usable configuration for this tree"
      if command -v cppcheck &>/dev/null; then
        echo "   Falling back to cppcheck"
        _cppcheck_run
        return $?
      fi
      return 2
    fi
    return "$rc"
  fi

  if command -v cppcheck &>/dev/null; then
    _cppcheck_run
    return $?
  fi

  echo "No C/C++ analysis tools (clang-tidy/cppcheck)"
  return 2
}

# cppcheck exits 0 by default *even when it reports errors* -- the verdict has to
# be requested explicitly. --error-exitcode makes "found something" non-zero while
# leaving "ran fine" at 0, which is exactly the 0/1 split Gate 1 consumes. Only
# `error` severity trips it; `warning`/`style`/`performance` stay informational so
# that a first adoption of the gate is not flooded by false positives.
_cppcheck_run() {
  local out rc
  out=$(cppcheck --enable=warning,performance,portability --inline-suppr --quiet \
    --error-exitcode=1 --suppress=missingIncludeSystem . 2>&1)
  rc=$?
  printf '%s\n' "$out" | head -20
  # 1 = findings; anything else cppcheck-specific (e.g. 2 = internal error) is
  # "could not execute" territory, which Gate 1 treats as fail-closed.
  case "$rc" in
    0|1) return "$rc" ;;
    *)   return 2 ;;
  esac
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
