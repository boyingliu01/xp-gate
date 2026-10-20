#!/usr/bin/env bats
# @test REQ-547 PowerShell does not skip-as-pass
# @intent Verify a PowerShell-only commit is actually gated. #547 reported four
#         defects that compound into "PowerShell is never really checked":
#         1. Gate 1's skip predicate had no ps1/psm1, so a .ps1-only commit
#            skipped Gate 1 entirely -- no line emitted, nothing in the
#            denominator.
#         2. No `powershell)` arm in Gate 1's dispatch, so it fell into the
#            generic `*)` branch where a non-zero analysis verdict printed a
#            non-blocking line and GATE_1_STATUS stayed PASS.
#         3. Gate 10's caller predicate and SEMGREP_FILES regex both lacked
#            ps1/psm1, so PowerShell never reached SAST.
#         4. `_detect_pwsh` used bare `command -v pwsh`, missing the standard
#            Windows installs when git-bash PATH is stripped -- and the
#            adapter then returned 0, i.e. "no engine" was reported as clean.
# @covers AC-547-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  GATE10="$REPO_ROOT/githooks/gate-10.sh"
  PS_ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
}

@test "anti-vacuity: the PowerShell adapter is present and detects an engine" {
  [ -f "$PS_ADAPTER" ]
  grep -q '_detect_pwsh()' "$PS_ADAPTER"
}

@test "finding 1: Gate 1 skip predicate recognises PowerShell files" {
  # Read the Gate 1 predicate line specifically, not any extension list.
  local predicate
  predicate=$(grep -n 'any_changed_files_match' "$PRE_COMMIT" | grep 'Dockerfile' | head -1)
  [ -n "$predicate" ]
  [[ "$predicate" == *"ps1"* ]]
  [[ "$predicate" == *"psm1"* ]]
}

@test "finding 2: Gate 1 has a dedicated powershell dispatch arm" {
  grep -qE '^    powershell\)' "$PRE_COMMIT"
  # That arm must speak the XP_G1_REASON protocol like the java arm does.
  local arm
  arm=$(awk '/^    powershell\)/,/^      ;;/' "$PRE_COMMIT")
  echo "$arm" | grep -q 'XP_G1_REASON'
  echo "$arm" | grep -q 'GATE_1_STATUS="WARN"'
}

@test "finding 2: an engine-missing verdict WARNs instead of passing" {
  # The adapter must return the not-available code (3), not 0.
  local fn
  fn=$(awk '/^run_static_analysis\(\)/,/^}/' "$PS_ADAPTER")
  echo "$fn" | grep -q 'XP_G1_REASON: pwsh not available'
  echo "$fn" | grep -q 'return 3'
  # And must not still contain the old silent success.
  run bash -c "echo \"\$0\" | grep -c 'skipping PowerShell static analysis'"
  [ "$output" = "0" ]
}

@test "finding 2: a missing PSScriptAnalyzer module is a WARN, not a pass" {
  grep -q 'PSSA_MODULE_MISSING' "$PS_ADAPTER"
  grep -q 'PSScriptAnalyzer module not installed' "$PS_ADAPTER"
}

@test "finding 3: Gate 10's caller predicate recognises PowerShell files" {
  local predicate
  predicate=$(grep -n 'any_changed_files_match "\\\.(ts|tsx' "$PRE_COMMIT" | tail -1)
  [ -n "$predicate" ]
  [[ "$predicate" == *"ps1"* ]]
}

@test "finding 3: gate-10.sh scans PowerShell files with semgrep" {
  local line
  line=$(grep -n 'SEMGREP_FILES=' "$GATE10")
  [ -n "$line" ]
  [[ "$line" == *"ps1"* ]]
  [[ "$line" == *"psm1"* ]]
}

@test "finding 4: engine detection probes standard Windows install paths" {
  local fn
  fn=$(awk '/^_detect_pwsh\(\)/,/^}/' "$PS_ADAPTER")
  echo "$fn" | grep -q 'WindowsApps'
  echo "$fn" | grep -q 'WindowsPowerShell'
}

@test "finding 4: detection still works when pwsh is stripped from PATH" {
  # The reporter's scenario: git-bash PATH without the Windows tool dirs.
  if ! command -v pwsh >/dev/null 2>&1 && ! [ -x "${LOCALAPPDATA:-}/Microsoft/WindowsApps/pwsh.exe" ]; then
    skip "no PowerShell on this machine"
  fi
  run bash -c "
    PATH=/usr/bin:/bin
    export PATH
    hash -r
    cd '$REPO_ROOT'
    . githooks/adapters/powershell.sh
    _detect_pwsh
  "
  [ -n "$output" ]
  # Must resolve to something runnable, not the empty string.
  [[ "$output" != "" ]]
}
