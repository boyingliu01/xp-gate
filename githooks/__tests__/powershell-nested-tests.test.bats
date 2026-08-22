#!/usr/bin/env bats

# @test REQ-GATE5-POWERSHELL-NESTED
# @intent Verify Pester discovery reaches nested repository tests without scanning generated or vendor roots
# @covers AC-GATE5-POWERSHELL-NESTED-01, AC-GATE5-POWERSHELL-NESTED-02

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  TEST_DIR=$(mktemp -d)
  CAPTURE_FILE="$TEST_DIR/pwsh-invocation.txt"

  mkdir -p \
    "$TEST_DIR/tests" \
    "$TEST_DIR/test" \
    "$TEST_DIR/skills/clipboard-vision/__tests__" \
    "$TEST_DIR/skills/clip board's vision/__tests__" \
    "$TEST_DIR/src"
  touch \
    "$TEST_DIR/tests/top-level.Tests.ps1" \
    "$TEST_DIR/test/legacy.Tests.ps1" \
    "$TEST_DIR/skills/clipboard-vision/__tests__/clipboard-vision.Tests.ps1" \
    "$TEST_DIR/skills/clip board's vision/__tests__/quoted.Tests.ps1" \
    "$TEST_DIR/src/module.ps1" \
    "$TEST_DIR/src/not-coverage.Tests.ps1"

  for excluded_root in .git node_modules dist coverage; do
    mkdir -p "$TEST_DIR/$excluded_root/nested"
    touch \
      "$TEST_DIR/$excluded_root/nested/excluded.Tests.ps1" \
      "$TEST_DIR/$excluded_root/nested/excluded-source.ps1"
  done

  for excluded_root in \
    plugins/claude-code/skills \
    plugins/opencode/skills \
    plugins/qoder/skills \
    src/npm-package/skills \
    src/npm-package/plugins; do
    mkdir -p "$TEST_DIR/$excluded_root/clipboard-vision/__tests__"
    touch \
      "$TEST_DIR/$excluded_root/clipboard-vision/__tests__/excluded.Tests.ps1" \
      "$TEST_DIR/$excluded_root/clipboard-vision/excluded-source.ps1"
  done

  cat > "$TEST_DIR/fake-pwsh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE_FILE"
EOF
  chmod +x "$TEST_DIR/fake-pwsh"

  cd "$TEST_DIR" || return
  # shellcheck disable=SC1090
  source "$ADAPTER"
  # shellcheck disable=SC2317
  _detect_pwsh() {
    printf '%s\n' "$TEST_DIR/fake-pwsh"
  }
  export CAPTURE_FILE
}

teardown() {
  rm -rf "$TEST_DIR"
}

captured_pester_command() {
  grep 'Invoke-Pester' "$CAPTURE_FILE"
}

assert_test_array() {
  local command="$1"
  [[ "$command" == *"Invoke-Pester -Path @("* ]]
  [[ "$command" == *"'./tests/top-level.Tests.ps1'"* ]]
  [[ "$command" == *"'./test/legacy.Tests.ps1'"* ]]
  [[ "$command" == *"'./skills/clipboard-vision/__tests__/clipboard-vision.Tests.ps1'"* ]]
  [[ "$command" == *"'./skills/clip board''s vision/__tests__/quoted.Tests.ps1'"* ]]
  [[ "$command" != *"/.git/"* ]]
  [[ "$command" != *"/node_modules/"* ]]
  [[ "$command" != *"/dist/"* ]]
  [[ "$command" != *"/coverage/"* ]]
  [[ "$command" != *"/plugins/claude-code/skills/"* ]]
  [[ "$command" != *"/plugins/opencode/skills/"* ]]
  [[ "$command" != *"/plugins/qoder/skills/"* ]]
  [[ "$command" != *"/src/npm-package/skills/"* ]]
  [[ "$command" != *"/src/npm-package/plugins/"* ]]
}

@test "run_tests passes explicit top-level and nested test paths with safe quoting" {
  run run_tests

  [ "$status" -eq 0 ]
  [[ "$output" == *"Running Pester tests"* ]]
  [ -f "$CAPTURE_FILE" ]
  command=$(captured_pester_command)
  assert_test_array "$command"
  [[ "$command" == *"-Path @("*" -PassThru"* ]]
  [[ "$command" != *"-CodeCoverage"* ]]
  [[ "$command" != *"/src/module.ps1"* ]]
}

@test "run_coverage passes explicit safe test and source arrays" {
  run run_coverage

  [ "$status" -eq 0 ]
  [[ "$output" == *"Running Pester with code coverage"* ]]
  [ -f "$CAPTURE_FILE" ]
  command=$(captured_pester_command)
  assert_test_array "$command"
  [[ "$command" == *"-CodeCoverage @("* ]]
  coverage_array=${command#* -CodeCoverage }
  coverage_array=${coverage_array% -PassThru*}
  [[ "$coverage_array" == "@("* ]]
  [[ "$coverage_array" == *"'./src/module.ps1'"* ]]
  [[ "$coverage_array" != *".Tests.ps1"* ]]
  [[ "$coverage_array" != *"/.git/"* ]]
  [[ "$coverage_array" != *"/node_modules/"* ]]
  [[ "$coverage_array" != *"/dist/"* ]]
  [[ "$coverage_array" != *"/coverage/"* ]]
}

@test "run_tests skips without invoking PowerShell when unavailable" {
  # shellcheck disable=SC2317
  _detect_pwsh() { printf '\n'; }

  run run_tests

  [ "$status" -eq 0 ]
  [[ "$output" == *"PowerShell not available, skipping PowerShell tests"* ]]
  [ ! -e "$CAPTURE_FILE" ]
}

@test "run_coverage skips without invoking PowerShell when unavailable" {
  # shellcheck disable=SC2317
  _detect_pwsh() { printf '\n'; }

  run run_coverage

  [ "$status" -eq 0 ]
  [[ "$output" == *"PowerShell not available, skipping PowerShell coverage"* ]]
  [ ! -e "$CAPTURE_FILE" ]
}

@test "adapter avoids Bash 4 array-loading builtins" {
  run grep -En '(^|[[:space:]])(mapfile|readarray)([[:space:]]|$)' "$ADAPTER"

  [ "$status" -ne 0 ]
}

@test "Windows PowerShell test invocation uses process-scoped ExecutionPolicy Bypass" {
  for executable in powershell.exe powershell; do
    cp "$TEST_DIR/fake-pwsh" "$TEST_DIR/$executable"
    chmod +x "$TEST_DIR/$executable"
    # shellcheck disable=SC2317
    _detect_pwsh() { printf '%s\n' "$TEST_DIR/$executable"; }

    run run_tests

    [ "$status" -eq 0 ]
    [ "$(sed -n '1p' "$CAPTURE_FILE")" = "-NoProfile" ]
    [ "$(sed -n '2p' "$CAPTURE_FILE")" = "-ExecutionPolicy" ]
    [ "$(sed -n '3p' "$CAPTURE_FILE")" = "Bypass" ]
    [ "$(sed -n '4p' "$CAPTURE_FILE")" = "-Command" ]
  done
}

@test "pwsh test invocation remains compatible without Windows-only policy arguments" {
  cp "$TEST_DIR/fake-pwsh" "$TEST_DIR/pwsh"
  chmod +x "$TEST_DIR/pwsh"
  # shellcheck disable=SC2317
  _detect_pwsh() { printf '%s\n' "$TEST_DIR/pwsh"; }

  run run_tests

  [ "$status" -eq 0 ]
  run grep -F -- '-ExecutionPolicy' "$CAPTURE_FILE"
  [ "$status" -ne 0 ]
  run grep -F -- '-Command' "$CAPTURE_FILE"
  [ "$status" -eq 0 ]
}
