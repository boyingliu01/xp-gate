#!/usr/bin/env bats
# @test REQ-576
# @intent Two more PowerShell fail-open holes from #567, in the SCOPED analysis
#         path (`.xp-gate-powershell-analysis-paths` present).
#
#         B. `PSScriptAnalyzerSettings.psd1` missing while `-Settings` still points
#            at it. `-Settings` given a nonexistent path is a NON-terminating
#            error, so combined with a silenced error action the result set came
#            back empty and an unanalysed tree was judged PASS. The settings file
#            must only be passed when it actually exists, and a broken settings
#            file must fail closed rather than produce an empty result.
#
#         These cases assert the PowerShell fragment's SHAPE, because the branch
#         only executes inside pwsh with PSScriptAnalyzer installed — unavailable
#         on the Linux CI image. Shape assertions are weaker than behaviour, so
#         each one names the exact mistake it prevents rather than merely
#         grepping for a keyword.
# @covers AC-576-04
bats_require_minimum_version 1.5.0

setup() {
  ADAPTER="$BATS_TEST_DIRNAME/../adapters/powershell.sh"
  [ -f "$ADAPTER" ] || skip "powershell adapter not present"
  # The scoped fragment: everything between the analysis-targets guard and the
  # end of the pwsh invocation it feeds.
  FRAGMENT="$BATS_TEST_TMPDIR/fragment.ps1"
  sed -n '/Non-terminating errors must become terminating/,/exit 0$/p' "$ADAPTER" > "$FRAGMENT"
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR"
}

@test "AC-576-04: the settings fragment was extracted at all (anti-vacuity)" {
  run grep -c 'Invoke-ScriptAnalyzer' "$FRAGMENT"
  [ "$output" -ge 1 ] || { echo "nothing extracted from the adapter"; return 1; }

  run grep -c 'PSScriptAnalyzerSettings.psd1' "$FRAGMENT"
  [ "$output" -ge 1 ] || { echo "the settings path is not in the fragment"; return 1; }
}

@test "AC-576-04: -Settings is only passed when the file exists" {
  # The bug: `-Settings <missing path>` without a guard. Both the existence test
  # and the guarded call must be present, and the guarded call must be the only
  # place -Settings appears.
  run grep -c 'Test-Path -LiteralPath \\\$settings' "$FRAGMENT"
  [ "$output" -ge 1 ] || { echo "no existence guard on the settings file"; return 1; }

  # Every -Settings use must sit inside the guard's else-branch of that Test-Path.
  local guard_line settings_lines
  guard_line=$(grep -n 'Test-Path -LiteralPath \\\$settings' "$FRAGMENT" | head -1 | cut -d: -f1)
  settings_lines=$(grep -c -- '-Settings \\\$settings' "$FRAGMENT")
  [ "$settings_lines" -eq 1 ] || {
    echo "expected exactly one -Settings call, found $settings_lines"
    return 1
  }
  # And it must come AFTER the guard, not before it.
  local call_line
  call_line=$(grep -n -- '-Settings \\\$settings' "$FRAGMENT" | head -1 | cut -d: -f1)
  [ "$call_line" -gt "$guard_line" ] || {
    echo "-Settings is used before the existence guard (line $call_line vs $guard_line)"
    return 1
  }
}

@test "AC-576-04: the settings branch has an unguarded alternative for a missing file" {
  # The guard is useless if both branches pass -Settings. The no-settings branch
  # must invoke the analyzer WITHOUT -Settings.
  run grep -c -- '-Severity Error,Warning -ErrorAction Stop)$' "$FRAGMENT"
  [ "$output" -ge 1 ] || {
    echo "no -Settings-free Invoke-ScriptAnalyzer call — the guard guards nothing"
    return 1
  }
}

@test "AC-576-04: analysis errors terminate instead of yielding an empty result set" {
  # The root cause of B: a non-terminating error plus a silenced action produced
  # an empty result that read as a clean pass.
  run grep -c "ErrorActionPreference = 'Stop'" "$FRAGMENT"
  [ "$output" -ge 1 ] || { echo "non-terminating errors are not promoted"; return 1; }

  # And the try/catch must turn a raised error into a distinct fail-closed exit
  # (3), never into findings (1) or a pass (0).
  run grep -c 'PSSA_RUN_ERROR' "$FRAGMENT"
  [ "$output" -ge 1 ] || { echo "a raised error is not surfaced distinctly"; return 1; }
}

@test "AC-576-04: the adapter never silences analyzer errors wholesale" {
  # `-ErrorAction SilentlyContinue` on the analyzer call is the exact shape that
  # made an unreadable tree look like a clean one.
  run grep -c -- '-ErrorAction SilentlyContinue' "$FRAGMENT"
  [ "$output" -eq 0 ] || {
    echo "SilentlyContinue is back in the analysis fragment"
    return 1
  }
}
