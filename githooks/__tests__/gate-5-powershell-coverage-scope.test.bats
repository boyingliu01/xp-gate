#!/usr/bin/env bats
# @test REQ-806
# @intent A repository with no PowerShell tests cannot produce coverage.xml. Gate 5
#   demanded one anyway and BLOCKED, refusing every commit that touched a .ps1 on
#   evidence the repo could never supply -- in the same run the gate printed
#   "No Pester tests found". "No tests to run" and "tests ran but coverage is
#   missing" are different states and must not collapse into one verdict.
# @covers AC-806-G5a

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"

  # Extract ONLY the gate_5_run body. Sourcing the whole entry file executes the
  # entire hook chain (it reached Gate 0 and blocked the fixture as a protected
  # branch), so the function text is lifted by line range instead. The range is
  # anchored on the function header and its matching closing brace at column 0.
  local start end
  start=$(grep -n '^gate_5_run() {' "$GATE5" | head -1 | cut -d: -f1)
  end=$(awk -v s="$start" 'NR>s && /^}$/ {print NR; exit}' "$GATE5")
  [ -n "$start" ] && [ -n "$end" ] || { echo "cannot extract gate_5_run" >&2; return 1; }
  sed -n "${start},${end}p" "$GATE5" > "$BATS_TEST_TMPDIR/gate5fn.sh"

  FIXTURE="$(mktemp -d)"
  (
    cd "$FIXTURE" || exit 99
    git init -q .
    git config user.email t@t
    git config user.name t
    mkdir -p src
    printf 'Write-Host "hi"\n' > src/a.ps1
    printf '{"name":"x","version":"1.0.0"}\n' > package.json
    git add -A
    # The fixture must not run the developer's real hooks (core.hooksPath is set
    # globally on installed machines), or `git commit` enforces the whole gate
    # chain against the fixture and setup fails before the test begins.
    git -c core.hooksPath= commit -qm init
  )
}

teardown() {
  [ -n "$FIXTURE" ] && rm -rf "$FIXTURE"
}

# Drives gate_5_run() with the driver contract pre-commit provides.
run_ps_coverage() {
  local fixture="$1"
  (
    cd "$fixture" || exit 99
    gate_enabled() { return 0; }
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    any_changed_files_match() { return 1; }
    resolve_adapter_path() { printf '%s\n' ""; }
    source_gate_lib() { return 1; }
    run_node_bin() { return 1; }
    now_ms() { echo 0; }
    gate_5c_alignment() { GATE_5C_STATUS="SKIP"; return 0; }
    # gate_5_run calls these before reaching the coverage stage. Without them it
    # dies on "command not found" and never evaluates coverage at all -- a silent
    # no-op that would make the assertions below pass for the wrong reason.
    filter_project_paths() { cat; }
    has_project_lang() { [ "$1" = "powershell" ]; }
    PROJECT_LANGS="powershell"
    export PROJECT_LANGS
    get_staged_files() { printf '%s\n' "src/a.ps1"; }
    get_changed_code_files() { printf '%s\n' "src/a.ps1"; }

    COVERAGE_THRESHOLD=78
    PARTIAL_TEST_RUN=false
    CURRENT_LANG=powershell
    XP_GATE_ONLY_GATE=""
    CHANGED_CODE_FILES="src/a.ps1"
    CHANGED_FILES="src/a.ps1"
    STAGED_FILES="src/a.ps1"
    export COVERAGE_THRESHOLD PARTIAL_TEST_RUN CURRENT_LANG XP_GATE_ONLY_GATE
    export CHANGED_CODE_FILES CHANGED_FILES STAGED_FILES

    # shellcheck disable=SC1090,SC1091
    source "$BATS_TEST_TMPDIR/gate5fn.sh"

    if ! declare -f gate_5_run >/dev/null 2>&1; then
      echo "HARNESS_NOP"
      return 99
    fi
    set +e
    gate_5_run 2>&1
    echo "RC=$?"
  )
}

@test "AC-806-G5a anti-vacuity: the harness really reaches the coverage branch" {
  run run_ps_coverage "$FIXTURE"
  [[ "$output" != *"HARNESS_NOP"* ]] || { echo "harness never reached gate_5_run"; return 1; }
  [[ "$output" == *"coverage"* ]] || { echo "harness did not reach the coverage stage"; return 1; }
}

@test "AC-806-G5a: a repo with no PowerShell tests does not demand coverage.xml" {
  run run_ps_coverage "$FIXTURE"
  [[ "$output" != *"coverage.xml not found"* ]] ||
    { echo "BLOCKED on a coverage artifact no test could produce"; return 1; }
}

@test "AC-806-G5a: the skip is explainable, not silent" {
  run run_ps_coverage "$FIXTURE"
  [[ "$output" == *"Pester"* ]] ||
    { echo "no explanation mentioning the test runner"; return 1; }
}

@test "AC-806-G5a anti-vacuity: a repo WITH Pester tests still requires coverage.xml" {
  mkdir -p "$FIXTURE/tests"
  printf 'Describe "x" { It "y" { 1 | Should -Be 1 } }\n' > "$FIXTURE/tests/Sample.Tests.ps1"
  run run_ps_coverage "$FIXTURE"
  [[ "$output" == *"coverage.xml not found"* ]] ||
    { echo "a repo WITH tests lost its coverage enforcement"; return 1; }
}
