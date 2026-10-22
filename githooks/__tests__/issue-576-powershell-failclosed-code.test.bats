#!/usr/bin/env bats
# @test REQ-576
# @intent The PowerShell adapter's contract is that a fail-closed condition is
#         communicated BOTH as an `XP_G1_REASON:` line AND as a non-zero return
#         code. The pre-commit powershell arm switches on the RETURN CODE
#         first — it only reads the reason for the message text:
#
#             PS_G1_OUTPUT=$(...; run_static_analysis 2>&1) || PS_G1_EXIT=$?
#             PS_G1_REASON=$(printf '%s\n' "$PS_G1_OUTPUT" | sed -n 's/^XP_G1_REASON: //p' | head -1)
#             case "$PS_G1_EXIT" in
#               0) echo "✅ PASSED - PowerShell code quality (PSScriptAnalyzer)." ...
#
#         So a reason emitted with `return 0` is DROPPED: the gate prints PASSED
#         and the reason never reaches the report.
#
#         Measured before this fix, with a scope file listing one present and one
#         missing path and a clean scan:
#
#             run_static_analysis -> RETURN CODE = 0
#
#         i.e. "product code may have escaped the gate" was announced on stdout
#         and then discarded, and Gate 1 passed. #571 shipped that: it emitted the
#         reason but returned success. The installed copy of the adapter
#         (`~/.config/xp-gate/adapters/powershell.sh`) had already noticed and
#         returns 3 when any scope entry is missing.
#
#         Also covered: a PowerShell exception during the scan. Without catching
#         it, pwsh exits 1, and exit 1 means "findings" — so an analysis ERROR is
#         reported as lint violations. It must be a distinct, fail-closed verdict.
# @covers AC-576-01, AC-576-02, AC-576-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo" "$WORK/bin"
  cd "$WORK/repo" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Install an engine stub that exits with the given code and prints the given text.
install_stub_engine() {
  local rc="$1"
  local text="${2:-}"
  cat > "$WORK/bin/pwsh" << STUB
#!/bin/bash
${text:+echo '$text'}
exit $rc
STUB
  chmod +x "$WORK/bin/pwsh"
  export PATH="$WORK/bin:$PATH"
}

# Source the adapter, run static analysis, print output then exit code.
run_analysis_capture() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    run_static_analysis 2>&1
    echo "___EXIT___$?"
  ' _ "$ADAPTER"
}

@test "AC-576-01: a missing scope entry returns a fail-closed code, not 0" {
  install_stub_engine 0
  mkdir -p src/present
  printf 'src/present\nsrc/renamed-away\n' > .xp-gate-powershell-analysis-paths

  run run_analysis_capture
  [ -n "$output" ]
  [[ "$output" == *"XP_G1_REASON: analysis-path-missing:src/renamed-away"* ]]
  # The reason must be backed by a non-zero code: pre-commit switches on the
  # code, so `return 0` silently turns this into a PASSED line.
  [[ "$output" != *"___EXIT___0"* ]] || {
    echo "expected a non-zero return code, got 0: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
}

@test "AC-576-02: an empty scope file returns a fail-closed code, not 0" {
  install_stub_engine 0
  printf '# nothing declared\n\n' > .xp-gate-powershell-analysis-paths

  run run_analysis_capture
  [[ "$output" == *"XP_G1_REASON: analysis-paths-empty"* ]]
  [[ "$output" != *"___EXIT___0"* ]] || {
    echo "expected a non-zero return code, got 0: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
}

@test "AC-576-03: an analysis exception is not reported as lint findings" {
  # pwsh exiting 1 in this adapter means "Invoke-ScriptAnalyzer found things".
  # A scan that CRASHED must not be able to impersonate that: it is a fail-closed
  # "could not verify" verdict, which is exit 2 in this mapping.
  #
  # The ONLY way the fragment can signal a crash is `exit 3` (see the
  # `try { ... } catch { Write-Output ('PSSA_RUN_ERROR: ' + ...); exit 3 }` in the
  # scoped run). So the stub exits 3 and a real fragment is impossible here --
  # a shell stub cannot execute the inline PowerShell. What is asserted is the
  # MAPPING: 3 must not fall into the `1) findings` arm and must not be swallowed
  # by the `*) unusable` arm without the reason.
  install_stub_engine 3 "PSSA_RUN_ERROR: settings file is not valid"

  mkdir -p src
  echo 'Write-Host "hi"' > src/a.ps1

  run run_analysis_capture
  [ -n "$output" ]
  # Findings would be exit 1; an unusable run is exit 2.
  [[ "$output" != *"___EXIT___1"* ]] || {
    echo "an analysis crash was mapped to the findings verdict; output: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
  [[ "$output" == *"___EXIT___2"* ]] || {
    echo "expected exit 2 (unusable), got: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
  # And the captured exception text is surfaced, not just a generic reason.
  [[ "$output" == *"settings file is not valid"* ]] || {
    echo "the captured PowerShell error text was dropped; output: $(printf '%s' "$output" | tr '\n' ' ')"
    return 1
  }
}
