#!/usr/bin/env bats

# ============================================================================
# The hook libraries under githooks/lib/ are load-bearing: pre-commit sources
# them at startup, and Gate 5's test-failure judgement (lib/test-failure.sh,
# extracted for #473) lives there. `bash githooks/install.sh` copied only the
# hook files and the adapters, never lib/, so an installed hook ran with
# "now_ms: command not found" and — once handle_test_failure went missing —
# `handle_test_failure ... || exit 1` blocked EVERY commit in that project.
#
# Two invariants are pinned:
#   1. install.sh actually lands lib/ next to the hooks it installs.
#   2. every lib/<name> the hooks source exists in the canonical directory
#      (so a future extraction cannot ship without its installer entry).
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SOURCE_GITHOOKS="$REPO_ROOT/githooks"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "install.sh copies githooks/lib next to the installed hooks" {
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh'"
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/.git/hooks/pre-commit" ]
  [ -f "$TEST_DIR/.git/hooks/lib/test-failure.sh" ]
  [ -f "$TEST_DIR/.git/hooks/lib/now-ms.sh" ]
}

@test "an installed hook can source every library it references" {
  # This is the real failure mode: the reference resolves against the hook's own
  # directory, so the file must exist there, not only in the repository.
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh'"
  [ "$status" -eq 0 ]

  run bash -c "
    cd '$TEST_DIR'
    missing=0
    for ref in \$(grep -o 'lib/[a-zA-Z0-9._-]*' .git/hooks/pre-commit | sort -u); do
      case \"\$ref\" in
        *.sh|*.cjs) [ -f \".git/hooks/\$ref\" ] || { echo \"MISSING \$ref\"; missing=1; } ;;
      esac
    done
    echo \"missing=\$missing\"
  "
  [[ "$output" != *"MISSING"* ]]
  [[ "$output" == *"missing=0"* ]]
}

@test "every library the hooks source exists in the canonical githooks/lib" {
  run bash -c "
    for hook in '$SOURCE_GITHOOKS/pre-commit' '$SOURCE_GITHOOKS/pre-push'; do
      grep -o 'lib/[a-zA-Z0-9._-]*' \"\$hook\"
    done | sort -u | while read -r ref; do
      case \"\$ref\" in
        *.sh|*.cjs) [ -f '$SOURCE_GITHOOKS/'\"\$ref\" ] || echo \"MISSING \$ref\" ;;
      esac
    done
  "
  [ "$output" = "" ]
}

@test "Gate 5's handler is reachable from the installed hook" {
  # Fail-closed is only acceptable when the file is really there.
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh' > /dev/null"
  [ "$status" -eq 0 ]

  run grep -c 'handle_test_failure' "$TEST_DIR/.git/hooks/lib/test-failure.sh"
  [ "$output" -ge 2 ]

  run grep -c 'lib/test-failure.sh' "$TEST_DIR/.git/hooks/pre-commit"
  [ "$output" -ge 1 ]
}
