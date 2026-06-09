#!/usr/bin/env bats

# ============================================================================
# Issue #187: Windows/Qoder bash hooks compatibility
# Verifies that Windows-incompatible commands (pip3, head) are handled
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
}

teardown() {
  rm -rf "$TEST_DIR"
}

HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"

@test "Issue #187: lizard install message uses pip (not pip3) for cross-platform compat" {
  # Check the pre-commit hook for pip3 references in lizard install message
  # The message should say "pip install" not "pip3 install"
  run grep -n "pip.*install.*lizard" "$HOOK_PATH"
  echo "Lizard install lines: $output"

  # Must NOT contain pip3 (Windows-incompatible)
  run grep "pip3.*install.*lizard" "$HOOK_PATH"
  echo "pip3 lines found: $output"
  [ "$status" -ne 0 ]

  # Must contain pip (cross-platform)
  run grep "pip.*install.*lizard" "$HOOK_PATH"
  echo "pip lines found: $output"
  [ "$status" -eq 0 ]
}

@test "Issue #187: TOOL-INSTALLATION-GUIDE.md uses pip (not pip3) for lizard" {
  GUIDE_PATH="$BATS_TEST_DIRNAME/../TOOL-INSTALLATION-GUIDE.md"

  # Must NOT contain pip3 for lizard install
  run grep "pip3.*install.*lizard" "$GUIDE_PATH"
  echo "pip3 lines in guide: $output"
  [ "$status" -ne 0 ]

  # Must contain pip for lizard install
  run grep "pip.*install.*lizard" "$GUIDE_PATH"
  echo "pip lines in guide: $output"
  [ "$status" -eq 0 ]
}
