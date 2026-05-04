#!/usr/bin/env bash

run_static_analysis() {
  if command -v pwsh &>/dev/null; then
    pwsh -Command "if (Get-Module -ListAvailable -Name PSScriptAnalyzer) { Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning -SuppressIncludePresetRules } else { exit 1 }" 2>&1 | head -30
    return $?
  else
    echo "PowerShell (pwsh) not available"
    return 1
  fi
}

run_lint() {
  run_static_analysis
}

run_tests() {
  if command -v pwsh &>/dev/null; then
    pwsh -Command "if (Get-Module -ListAvailable -Name Pester) { Invoke-Pester -CI -Output Minimal } else { exit 1 }" 2>&1 | tail -20
    return $?
  else
    echo "PowerShell (pwsh) not available"
    return 1
  fi
}

run_coverage() {
  if command -v pwsh &>/dev/null; then
    pwsh -Command "if (Get-Module -ListAvailable -Name Pester) { Invoke-Pester -CI -CodeCoverage (Get-ChildItem *.ps1 -Recurse) -CodeCoverageOutputFormat lcov } else { exit 1 }" 2>&1 | tail -10
    return $?
  else
    echo "PowerShell (pwsh) not available"
    return 1
  fi
}
