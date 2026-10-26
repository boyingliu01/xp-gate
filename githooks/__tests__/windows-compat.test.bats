#!/usr/bin/env bats

# ============================================================================
# Issue #187: Windows/Qoder bash hooks compatibility
# Verifies that Windows-incompatible commands (pip3, head) are handled
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

HOOKS_DIR="$BATS_TEST_DIRNAME/.."

@test "Issue #187: lizard install message uses pip (not pip3) for cross-platform compat" {
  # Lizard install guidance lives in the Gate 3 adapters, not pre-commit
  # The message should say "pip install" not "pip3 install"
  #
  # This used to also grep githooks/gates/gate-3-complexity.sh. That directory is
  # unreachable from any install and was deleted (see
  # issue-532-gate9-verdict.test.bats AC-A-02-05); the tree-wide pip3 scan at
  # line 25 already covers every file that actually ships.
  run grep -n "pip.*install.*lizard" "$HOOKS_DIR/gate-3.sh"
  echo "Lizard install lines: $output"

  # Must NOT contain pip3 (Windows-incompatible) anywhere in the hooks tree
  run grep -rn "pip3.*install.*lizard" "$HOOKS_DIR" --exclude-dir=__tests__
  echo "pip3 lines found: $output"
  [ "$status" -ne 0 ]

  # Must contain pip (cross-platform)
  run grep -n "pip.*install.*lizard" "$HOOKS_DIR/gate-3.sh"
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
