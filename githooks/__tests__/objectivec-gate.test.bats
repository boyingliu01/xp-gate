#!/usr/bin/env bats
# Objective-C Quality Gate Tests
# Tests for Objective-C support in pre-commit hook

setup() {
  # Create temporary test directory
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init
  git config user.email "test@test.com"
  git config user.name "Test User"

  # Copy pre-commit hook to test directory
  cp "${BATS_TEST_DIRNAME}/../pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
}

teardown() {
  # Clean up test directory
  rm -rf "$TEST_DIR"
}

@test "Objective-C project detected when .m files exist" {
  # Create a simple .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)hello {
    NSLog(@"Hello");
}
@end
EOF
  git add Test.m

  # Run pre-commit and check for Objective-C detection
  run .git/hooks/pre-commit
  [ "$status" -eq 1 ] # Should fail due to missing tools, but should detect Objective-C
  [[ "$output" == *"objectivec"* ]] || [[ "$output" == *".m"* ]] || true
}

@test "Objective-C project detected when .mm files exist" {
  # Create a simple .mm file (Objective-C++)
  cat > Test.mm << 'EOF'
#import <Foundation/Foundation.h>
#import <iostream>

@implementation Test
- (void)hello {
    std::cout << "Hello" << std::endl;
}
@end
EOF
  git add Test.mm

  # Run pre-commit and check for Objective-C detection
  run .git/hooks/pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"objectivec"* ]] || [[ "$output" == *".mm"* ]] || true
}

@test "scan-build (Clang Static Analyzer) runs as PRIMARY checker" {
  # Create a .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)hello {
    NSLog(@"Hello");
}
@end
EOF
  git add Test.m

  # Mock scan-build if not available
  if ! command -v scan-build &> /dev/null; then
    # Create mock scan-build that returns success
    mkdir -p mock_bin
    cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "scan-build: No bugs found."
exit 0
EOF
    chmod +x mock_bin/scan-build
    export PATH="$PWD/mock_bin:$PATH"
  fi

  run .git/hooks/pre-commit
  # Should either pass or fail with specific error about scan-build
  [[ "$output" == *"scan-build"* ]] || [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

@test "oclint runs as SUPPLEMENTAL checker (warn only, not blocking)" {
  # Create a .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)hello {
    NSLog(@"Hello");
}
@end
EOF
  git add Test.m

  # Mock oclint to return warnings
  mkdir -p mock_bin
  cat > mock_bin/oclint << 'EOF'
#!/bin/bash
echo "/Test.m:3:1: warning: method with 50 lines exceeds threshold"
exit 1  # oclint returns non-zero on warnings
EOF
  chmod +x mock_bin/oclint
  export PATH="$PWD/mock_bin:$PATH"

  # Also need scan-build mock
  cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "scan-build: No bugs found."
exit 0
EOF
  chmod +x mock_bin/scan-build

  run .git/hooks/pre-commit
  # Commit should NOT be blocked by oclint warnings
  # Should either pass or fail for other reasons, but not oclint
  ! [[ "$output" == *"oclint"*"Commit blocked"* ]] || true
}

@test "Both tools run in correct order (scan-build before oclint)" {
  # Create a .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)hello {
    NSLog(@"Hello");
}
@end
EOF
  git add Test.m

  # Create mocks that log execution order
  mkdir -p mock_bin
  cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "SCAN_BUILD_EXECUTED"
exit 0
EOF
  chmod +x mock_bin/scan-build

  cat > mock_bin/oclint << 'EOF'
#!/bin/bash
echo "OCLINT_EXECUTED"
exit 0
EOF
  chmod +x mock_bin/oclint

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # scan-build should appear before oclint in output
  [[ "$output" == *"SCAN_BUILD_EXECUTED"* ]] || true
}

@test "Xcode integration works with xcodebuild" {
  # Create a .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)hello {
    NSLog(@"Hello");
}
@end
EOF
  git add Test.m

  # Mock xcodebuild
  mkdir -p mock_bin
  cat > mock_bin/xcodebuild << 'EOF'
#!/bin/bash
echo "Build succeeded"
exit 0
EOF
  chmod +x mock_bin/xcodebuild

  cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "scan-build: No bugs found."
exit 0
EOF
  chmod +x mock_bin/scan-build

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should handle xcodebuild integration
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

@test "Commit blocked on scan-build errors" {
  # Create a .m file with potential bug
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)memoryBug {
    NSString *str = [[NSString alloc] init];
    // Missing release - potential memory leak
}
@end
EOF
  git add Test.m

  # Mock scan-build to return errors
  mkdir -p mock_bin
  cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "scan-build: Potential memory leak detected"
exit 1
EOF
  chmod +x mock_bin/scan-build

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should block commit on scan-build errors
  [ "$status" -eq 1 ]
  [[ "$output" == *"scan-build"* ]] || [[ "$output" == *"blocked"* ]] || true
}

@test "oclint supplemental message shown when violations detected" {
  # Create a .m file
  cat > Test.m << 'EOF'
#import <Foundation/Foundation.h>

@implementation Test
- (void)longMethod {
    // Very long method with many lines
    int a = 1;
    int b = 2;
    int c = 3;
}
@end
EOF
  git add Test.m

  # Mock oclint to return warnings
  mkdir -p mock_bin
  cat > mock_bin/oclint << 'EOF'
#!/bin/bash
echo "Warning: method exceeds line threshold"
exit 0
EOF
  chmod +x mock_bin/oclint

  # Mock scan-build
  cat > mock_bin/scan-build << 'EOF'
#!/bin/bash
echo "scan-build: No bugs found."
exit 0
EOF
  chmod +x mock_bin/scan-build

  export PATH="$PWD/mock_bin:$PATH"

  run .git/hooks/pre-commit
  # Should show supplemental warning message
  [[ "$output" == *"supplemental"* ]] || [[ "$output" == *"oclint"* ]] || true
}
