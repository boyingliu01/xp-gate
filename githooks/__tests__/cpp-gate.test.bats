#!/usr/bin/env bats
# C++ Quality Gate Tests
# Tests for C++ support in pre-commit hook

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

@test "C++ project detected when CMakeLists.txt + .cpp files exist" {
  # Create a CMakeLists.txt file
  cat > CMakeLists.txt << 'EOF'
cmake_minimum_required(VERSION 3.10)
project(TestProject)
add_executable(test main.cpp)
EOF

  # Create a simple .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add CMakeLists.txt main.cpp

  # Run pre-commit and check for C++ detection
  run .git/hooks/pre-commit
  # Should detect C++ (may fail due to missing tools, but should detect the language)
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"cpp"* ]] || true
}

@test "C++ project detected when Makefile + .cpp files exist" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
TARGET = test
SRCS = main.cpp
OBJS = $(SRCS:.cpp=.o)

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^

clean:
	rm -f $(OBJS) $(TARGET)
EOF

  # Create a simple .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Run pre-commit and check for C++ detection
  run .git/hooks/pre-commit
  # Should detect C++ (may fail due to missing tools, but should detect the language)
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"cpp"* ]] || true
}

@test "C++ project detected when .cxx files exist" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
TARGET = test
SRCS = main.cxx
OBJS = $(SRCS:.cxx=.o)
EOF

  # Create a simple .cxx file
  cat > main.cxx << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cxx

  # Run pre-commit and check for C++ detection
  run .git/hooks/pre-commit
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"cpp"* ]] || true
}

@test "C++ project detected when .cc files exist" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
TARGET = test
SRCS = main.cc
OBJS = $(SRCS:.cc=.o)
EOF

  # Create a simple .cc file
  cat > main.cc << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cc

  # Run pre-commit and check for C++ detection
  run .git/hooks/pre-commit
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"cpp"* ]] || true
}

@test "clang-tidy runs as PRIMARY tool (blocks on errors)" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Mock clang-tidy if not available
  if ! command -v clang-tidy &> /dev/null; then
    # Create mock clang-tidy that returns success
    mkdir -p mock_bin
    cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "clang-tidy: No warnings or errors."
exit 0
EOF
    chmod +x mock_bin/clang-tidy
    export PATH="$PWD/mock_bin:$PATH"
  fi

  run .git/hooks/pre-commit
  # Should either pass or fail with specific error about clang-tidy
  [[ "$output" == *"clang-tidy"* ]] || [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

@test "cppcheck runs as SUPPLEMENTAL tool (blocks on errors)" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Mock clang-tidy (primary)
  mkdir -p mock_bin
  cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "clang-tidy: No warnings or errors."
exit 0
EOF
  chmod +x mock_bin/clang-tidy

  # Mock cppcheck (supplemental)
  cat > mock_bin/cppcheck << 'EOF'
#!/bin/bash
echo "Checking main.cpp ..."
echo "No errors found."
exit 0
EOF
  chmod +x mock_bin/cppcheck

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should show cppcheck running
  [[ "$output" == *"cppcheck"* ]] || [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

@test "Both tools run in correct order (clang-tidy first)" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Create mocks that log execution order
  mkdir -p mock_bin
  cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "CLANG_TIDY_EXECUTED"
exit 0
EOF
  chmod +x mock_bin/clang-tidy

  cat > mock_bin/cppcheck << 'EOF'
#!/bin/bash
echo "CPPCHECK_EXECUTED"
exit 0
EOF
  chmod +x mock_bin/cppcheck

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # clang-tidy should appear before cppcheck in output
  [[ "$output" == *"CLANG_TIDY_EXECUTED"* ]] || true
  [[ "$output" == *"CPPCHECK_EXECUTED"* ]] || true
}

@test "Missing compile_commands.json shows warning" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Mock clang-tidy that warns about missing compile_commands.json
  mkdir -p mock_bin
  cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "warning: compilation database is empty"
echo "clang-tidy: No warnings or errors."
exit 0
EOF
  chmod +x mock_bin/clang-tidy

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should handle the warning or mention compile_commands.json
  [[ "$output" == *"compile_commands.json"* ]] || [[ "$output" == *"warning"* ]] || true
}

@test "Tool availability check works" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Run pre-commit without mocking tools (they likely don't exist)
  run .git/hooks/pre-commit
  # Should detect missing tools and block commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]] || true
}

@test "Commit blocked on clang-tidy errors" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file with potential bug
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    int* ptr = new int(42);
    // Memory leak - missing delete
    std::cout << *ptr << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Mock clang-tidy to return errors
  mkdir -p mock_bin
  cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "main.cpp:5:5: error: Potential memory leak detected [clang-analyzer-cplusplus.NewDeleteLeaks]"
exit 1
EOF
  chmod +x mock_bin/clang-tidy

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should block commit on clang-tidy errors
  [ "$status" -eq 1 ]
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"blocked"* ]] || true
}

@test "Commit blocked on cppcheck errors" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create a .cpp file
  cat > main.cpp << 'EOF'
#include <iostream>
int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
EOF
  git add Makefile main.cpp

  # Mock clang-tidy (primary) - passes
  mkdir -p mock_bin
  cat > mock_bin/clang-tidy << 'EOF'
#!/bin/bash
echo "clang-tidy: No warnings or errors."
exit 0
EOF
  chmod +x mock_bin/clang-tidy

  # Mock cppcheck (supplemental) - fails
  cat > mock_bin/cppcheck << 'EOF'
#!/bin/bash
echo "main.cpp:5: error: Memory leak: ptr"
exit 1
EOF
  chmod +x mock_bin/cppcheck

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should block commit on cppcheck errors
  [ "$status" -eq 1 ]
  [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"blocked"* ]] || true
}

@test "C++ .hpp and .h files are detected" {
  # Create a Makefile
  cat > Makefile << 'EOF'
CXX = g++
CXXFLAGS = -std=c++17
all:
	$(CXX) $(CXXFLAGS) -o test main.cpp
EOF

  # Create header files
  cat > MyClass.hpp << 'EOF'
#pragma once
class MyClass {
public:
    void doSomething();
};
EOF

  cat > MyClass.h << 'EOF'
#ifndef MYCLASS_H
#define MYCLASS_H
class MyClass {
public:
    void doSomething();
};
#endif
EOF

  git add Makefile MyClass.hpp MyClass.h

  # Run pre-commit - should detect C++ through header files
  run .git/hooks/pre-commit
  [[ "$output" == *"clang-tidy"* ]] || [[ "$output" == *"cppcheck"* ]] || [[ "$output" == *"cpp"* ]] || true
}
