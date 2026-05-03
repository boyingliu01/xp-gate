#!/usr/bin/env bash

# PowerShell adapter for quality gates
#
# Tool requirements:
#   - PSScriptAnalyzer: Install-Module PSScriptAnalyzer -Scope CurrentUser
#   - Pester:           Install-Module Pester -Scope CurrentUser
#
# Notes:
#   - Gate 2 (Duplicate Code): No PowerShell-native duplicate detector exists.
#     jscpd and lizard do not support .ps1. SKIP for now.
#   - Gate 3 (Cyclomatic Complexity): lizard does not analyze .ps1.
#     SKIP for now.
#   - Gate 4 (Principles Checker): No PowerShell principles checker.
#     SKIP for now.
#   - Gate 6 (Architecture): No PowerShell architecture tooling.
#     SKIP for now.

# Detect PowerShell executable (prefer pwsh 7+, fallback to powershell.exe 5.1)
_detect_pwsh() {
  if command -v pwsh &>/dev/null 2>&1; then
    echo "pwsh"
  elif command -v powershell.exe &>/dev/null 2>&1; then
    echo "powershell.exe"
  elif command -v powershell &>/dev/null 2>&1; then
    echo "powershell"
  else
    echo ""
  fi
}

run_static_analysis() {
  local PWSH
  PWSH=$(_detect_pwsh)
  if [ -n "$PWSH" ]; then
    echo "Running PSScriptAnalyzer static analysis on PowerShell scripts..."
    # Recursively analyze all .ps1 files from repo root
    # Exit with non-zero if Error or Warning severity issues found
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning
      if (\$results) {
        \$results | Format-Table -AutoSize
        exit 1
      }
      exit 0
    "
    return $?
  else
    echo "PowerShell not available, skipping PowerShell static analysis"
    return 0
  fi
}

run_lint() {
  # PSScriptAnalyzer covers both static analysis and linting
  run_static_analysis
}

run_tests() {
  local PWSH
  PWSH=$(_detect_pwsh)
  if [ -z "$PWSH" ]; then
    echo "PowerShell not available, skipping PowerShell tests"
    return 0
  fi

  # Check if Pester tests exist in common locations
  local test_paths=""
  if [ -d "tests" ]; then
    test_paths="tests/"
  elif [ -d "test" ]; then
    test_paths="test/"
  fi

  if [ -n "$test_paths" ] && find "$test_paths" -name "*.Tests.ps1" -type f 2>/dev/null | head -1 | grep -q "."; then
    echo "Running Pester tests..."
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-Pester -Path '$test_paths' -PassThru
      if (\$results.FailedCount -gt 0) {
        Write-Host \"FAILED: \$(\$results.FailedCount) test(s)\"
        exit 1
      }
      Write-Host \"PASSED: \$(\$results.PassedCount) test(s)\"
      exit 0
    "
    return $?
  elif find . -maxdepth 2 -name "*.Tests.ps1" -type f 2>/dev/null | head -1 | grep -q "."; then
    echo "Running Pester tests in current directory..."
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-Pester -CI -PassThru
      if (\$results.FailedCount -gt 0) {
        Write-Host \"FAILED: \$(\$results.FailedCount) test(s)\"
        exit 1
      }
      Write-Host \"PASSED: \$(\$results.PassedCount) test(s)\"
      exit 0
    "
    return $?
  else
    echo "No Pester tests found"
    return 0
  fi
}

run_coverage() {
  local PWSH
  PWSH=$(_detect_pwsh)
  if [ -z "$PWSH" ]; then
    echo "PowerShell not available, skipping PowerShell coverage"
    return 0
  fi

  local test_paths=""
  if [ -d "tests" ]; then
    test_paths="tests/"
  elif [ -d "test" ]; then
    test_paths="test/"
  fi

  if [ -n "$test_paths" ] || find . -maxdepth 2 -name "*.Tests.ps1" -type f 2>/dev/null | head -1 | grep -q "."; then
    echo "Running Pester with code coverage..."
    local path_arg="${test_paths:-.}"
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-Pester -Path '$path_arg' -CodeCoverage @(Get-ChildItem -Path . -Filter *.ps1 -Recurse -Exclude *.Tests.ps1) -PassThru
      \$pct = [math]::Round(\$results.CodeCoverage.CoveragePercent, 1)
      Write-Host \"Coverage: \$pct%\"
      if (\$pct -lt 80) {
        Write-Host \"WARNING: Coverage \$pct% is below 80% threshold\"
        exit 0
      }
      exit 0
    " 2>&1
    return $?
  else
    echo "No Pester tests found for coverage measurement"
    return 0
  fi
}
