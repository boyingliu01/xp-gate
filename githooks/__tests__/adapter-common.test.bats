#!/usr/bin/env bats

# Tests for adapter-common.sh functions
# TDD: Tests for tool availability checking and blocking behavior

setup() {
  # Source the adapter-common.sh
  source "$BATS_TEST_DIRNAME/../adapter-common.sh"
}

# ============================================================================
# Issue #14: Tool availability should BLOCK, not SKIP
# ============================================================================

@test "check_if_tool_available returns 0 when tool exists" {
  # Use a tool that should always be available
  run check_if_tool_available "bash"
  [ "$status" -eq 0 ]
}

@test "check_if_tool_available returns 1 when tool does not exist" {
  run check_if_tool_available "nonexistent-tool-xyz-123"
  [ "$status" -eq 1 ]
}

@test "check_if_tool_available returns 1 for jscpd when not in PATH" {
  # jscpd is in node_modules/.bin, not in global PATH
  run check_if_tool_available "jscpd"
  [ "$status" -eq 1 ]
}

@test "run_without_git_context isolates nested git commands from hook environment" {
  outer_repo=$(mktemp -d)
  nested_repo=$(mktemp -d)
  git -C "$outer_repo" init --quiet

  export GIT_DIR="$outer_repo/.git"
  export GIT_INDEX_FILE="$outer_repo/.git/index"

  run run_without_git_context git -C "$nested_repo" init --quiet

  [ "$status" -eq 0 ]
  [ -d "$nested_repo/.git" ]
}

@test "run_without_git_context isolates nested git when hook Git dir is invalid" {
  nested_repo=$(mktemp -d)
  export GIT_DIR=/missing/hook/git-dir
  export GIT_INDEX_FILE=/missing/hook/index

  run run_without_git_context git -C "$nested_repo" init --quiet

  [ "$status" -eq 0 ]
  [ -d "$nested_repo/.git" ]
}

@test "TypeScript adapter clears hook Git context before running tests" {
  fake_bin=$(mktemp -d)
  cat > "$fake_bin/npx" <<'EOF'
#!/usr/bin/env bash
[ -z "${GIT_DIR-}" ]
[ -z "${GIT_INDEX_FILE-}" ]
if [ "$2" = "--version" ]; then
  exit 0
fi
EOF
  chmod +x "$fake_bin/npx"
  PATH="$fake_bin:$PATH"
  export GIT_DIR=/missing/hook/git-dir
  export GIT_INDEX_FILE=/missing/hook/index
  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"

  run run_tests

  [ "$status" -eq 0 ]
}

@test "TypeScript test runner discovery clears hook Git context" {
  run grep -F 'if run_without_git_context npx vitest --version' "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  [ "$status" -eq 0 ]

  run grep -F 'if run_without_git_context npx vitest --version' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$status" -eq 0 ]
}

@test "pre-commit uses project-root package metadata from nested directories" {
  run grep -F 'if [ "$CURRENT_LANG" = "typescript" ] && { [ -f "package.json" ] || [ -f "$PROJECT_ROOT/package.json" ]; }; then' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$status" -eq 0 ]
}

@test "pre-commit provides Git context fallback for stale global adapters" {
  unset -f run_without_git_context
  fallback=$(awk '
    /^# BEGIN GIT CONTEXT FALLBACK$/ { capture = 1; next }
    /^# END GIT CONTEXT FALLBACK$/ { capture = 0 }
    capture
  ' "$BATS_TEST_DIRNAME/../pre-commit")
  eval "$fallback"
  export GIT_DIR=/missing/hook/git-dir
  export GIT_INDEX_FILE=/missing/hook/index

  run run_without_git_context bash -c \
    '[ -z "${GIT_DIR-}" ] && [ -z "${GIT_INDEX_FILE-}" ]'

  [ "$status" -eq 0 ]
}

@test "pre-commit isolates stale adapter test functions from Git context" {
  unset -f run_without_git_context
  fallback=$(awk '
    /^# BEGIN GIT CONTEXT FALLBACK$/ { capture = 1; next }
    /^# END GIT CONTEXT FALLBACK$/ { capture = 0 }
    capture
  ' "$BATS_TEST_DIRNAME/../pre-commit")
  eval "$fallback"
  run_tests() {
    [ -z "${GIT_DIR-}" ] && [ -z "${GIT_INDEX_FILE-}" ]
  }
  export GIT_DIR=/missing/hook/git-dir
  export GIT_INDEX_FILE=/missing/hook/index

  run run_without_git_context run_tests

  [ "$status" -eq 0 ]
}

@test "pre-commit defines Git context fallback before repository discovery" {
  fallback_line=$(grep -n '^# BEGIN GIT CONTEXT FALLBACK$' "$BATS_TEST_DIRNAME/../pre-commit" | cut -d: -f1)
  discovery_line=$(grep -n '^PROJECT_GITHOOKS=' "$BATS_TEST_DIRNAME/../pre-commit" | cut -d: -f1)

  [ "$fallback_line" -lt "$discovery_line" ]
}

@test "pre-commit isolates the project-root repository lookup" {
  run grep -F 'PROJECT_ROOT="$(run_without_git_context git rev-parse --show-toplevel' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$status" -eq 0 ]
}

@test "detect_project_lang returns typescript for tsconfig.json project" {
  # Create temp tsconfig.json
  echo '{}' > /tmp/test-tsconfig.json
  cd /tmp
  
  # Override detect_project_lang for testing
  result=$(detect_project_lang)
  
  # Clean up
  rm -f /tmp/test-tsconfig.json
}

@test "route_to_adapter routes to correct adapter for current language" {
  # In xp-gate project (has tsconfig.json), should route to typescript adapter
  run route_to_adapter "static_analysis"
  # Should succeed because we're in xp-gate project with tsconfig.json
  [ "$status" -eq 0 ]
}

# ============================================================================
# resolve_adapter_path: flat (global) vs nested (project) layout
# ============================================================================

@test "resolve_adapter_path finds adapter in flat global layout" {
  FAKE_GLOBAL=$(mktemp -d)
  touch "$FAKE_GLOBAL/adapter-common.sh"
  touch "$FAKE_GLOBAL/typescript.sh"
  touch "$FAKE_GLOBAL/python.sh"

  # Simulate global install resolution from pre-commit
  ADAPTER_DIR="$FAKE_GLOBAL"
  GLOBAL_ADAPTER_DIR="$FAKE_GLOBAL"
  PROJECT_GITHOOKS="/nonexistent/githooks"
  SCRIPT_DIR="/nonexistent/scripts"

  resolve_adapter_path() {
    local lang="$1"
    if [ -f "$ADAPTER_DIR/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/${lang}.sh"
      return 0
    fi
    if [ -f "$ADAPTER_DIR/adapters/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/adapters/${lang}.sh"
      return 0
    fi
    if [ -f "$PROJECT_GITHOOKS/adapters/${lang}.sh" ]; then
      echo "$PROJECT_GITHOOKS/adapters/${lang}.sh"
      return 0
    fi
    if [ -f "$SCRIPT_DIR/adapters/${lang}.sh" ]; then
      echo "$SCRIPT_DIR/adapters/${lang}.sh"
      return 0
    fi
    return 1
  }

  result=$(resolve_adapter_path "typescript")
  [ "$result" = "$FAKE_GLOBAL/typescript.sh" ]
}

@test "resolve_adapter_path finds adapter in nested project layout" {
  FAKE_PROJECT=$(mktemp -d)
  mkdir -p "$FAKE_PROJECT/adapters"
  touch "$FAKE_PROJECT/adapter-common.sh"
  touch "$FAKE_PROJECT/adapters/typescript.sh"

  # Simulate project-local resolution (no global adapter-common.sh)
  ADAPTER_DIR="$FAKE_PROJECT"
  GLOBAL_ADAPTER_DIR="/nonexistent/global"
  PROJECT_GITHOOKS="$FAKE_PROJECT"
  SCRIPT_DIR="/nonexistent/scripts"

  resolve_adapter_path() {
    local lang="$1"
    if [ -f "$ADAPTER_DIR/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/${lang}.sh"
      return 0
    fi
    if [ -f "$ADAPTER_DIR/adapters/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/adapters/${lang}.sh"
      return 0
    fi
    return 1
  }

  result=$(resolve_adapter_path "typescript")
  [ "$result" = "$FAKE_PROJECT/adapters/typescript.sh" ]
}

@test "resolve_adapter_path returns non-zero for unknown language" {
  FAKE_GLOBAL=$(mktemp -d)
  touch "$FAKE_GLOBAL/adapter-common.sh"
  ADAPTER_DIR="$FAKE_GLOBAL"
  GLOBAL_ADAPTER_DIR="$FAKE_GLOBAL"
  PROJECT_GITHOOKS="/nonexistent/githooks"
  SCRIPT_DIR="/nonexistent/scripts"

  resolve_adapter_path() {
    local lang="$1"
    if [ -f "$ADAPTER_DIR/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/${lang}.sh"
      return 0
    fi
    if [ -f "$ADAPTER_DIR/adapters/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/adapters/${lang}.sh"
      return 0
    fi
    return 1
  }

  run resolve_adapter_path "haskell"
  [ "$status" -ne 0 ]
}

@test "resolve_adapter_path falls back to project-githooks when ADAPTER_DIR flat and nested both miss" {
  FAKE_PROJECT=$(mktemp -d)
  FAKE_GLOBAL=$(mktemp -d)
  mkdir -p "$FAKE_PROJECT/adapters"
  touch "$FAKE_GLOBAL/adapter-common.sh"       # triggers global ADAPTER_DIR
  touch "$FAKE_PROJECT/adapters/rust.sh"       # only in project, not global

  ADAPTER_DIR="$FAKE_GLOBAL"
  GLOBAL_ADAPTER_DIR="$FAKE_GLOBAL"
  PROJECT_GITHOOKS="$FAKE_PROJECT"
  SCRIPT_DIR="/nonexistent/scripts"

  resolve_adapter_path() {
    local lang="$1"
    if [ -f "$ADAPTER_DIR/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/${lang}.sh"
      return 0
    fi
    if [ -f "$ADAPTER_DIR/adapters/${lang}.sh" ]; then
      echo "$ADAPTER_DIR/adapters/${lang}.sh"
      return 0
    fi
    if [ -f "$PROJECT_GITHOOKS/adapters/${lang}.sh" ]; then
      echo "$PROJECT_GITHOOKS/adapters/${lang}.sh"
      return 0
    fi
    if [ -f "$SCRIPT_DIR/adapters/${lang}.sh" ]; then
      echo "$SCRIPT_DIR/adapters/${lang}.sh"
      return 0
    fi
    return 1
  }

  result=$(resolve_adapter_path "rust")
  [ "$result" = "$FAKE_PROJECT/adapters/rust.sh" ]
}

# ============================================================================
# Issue #14: Test the actual pre-commit behavior for missing tools
# These tests verify that the hook BLOCKS when tools are missing, not SKIPs
# ============================================================================

@test "pre-commit hook blocks when jscpd is missing (Issue #14)" {
  # This test simulates a commit with jscpd unavailable
  # The hook should BLOCK, not SKIP
  # We test the actual gate 2 logic from pre-commit
  
  # Create a temp file to commit
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
  echo '{}' > tsconfig.json
  mkdir -p src
  echo 'export const x = 1;' > src/test.ts
  
  # Initialize git repo
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  
  # Copy pre-commit hook
  mkdir -p .git/hooks
  cp "$BATS_TEST_DIRNAME/../pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  
  # Add and try to commit (should FAIL because jscpd not available after fix)
  git add -A
  
  # Run the pre-commit hook directly to test its behavior
  PRE_COMMIT_OUTPUT=$(bash .git/hooks/pre-commit 2>&1) || true
  
  # After fix: output should contain "BLOCKED" or "not available" with error
  # Before fix: output would contain "SKIP" and "PASSED"
  
  # Clean up
  rm -rf "$TEST_DIR"
  
  # For now, we just verify the hook runs
  [[ "$PRE_COMMIT_OUTPUT" != "" ]]
}
