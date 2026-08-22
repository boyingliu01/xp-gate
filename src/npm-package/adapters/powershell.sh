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

_find_powershell_files() {
  local name_pattern="$1"
  find . \
    \( -type d \( -name .git -o -name node_modules -o -name dist -o -name coverage \) -prune \) -o \
    \( -type f -name "$name_pattern" -print \) 2>/dev/null
}

_powershell_path_array() {
  local path
  local separator=""
  printf '@('
  for path in "$@"; do
    path=${path//\'/\'\'}
    printf "%s'%s'" "$separator" "$path"
    separator=","
  done
  printf ')'
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

  local test_files=()
  local discovery_file
  local path
  local test_paths
  discovery_file=$(mktemp)
  _find_powershell_files "*.Tests.ps1" > "$discovery_file"
  while IFS= read -r path; do
    test_files[${#test_files[@]}]="$path"
  done < "$discovery_file"
  rm -f "$discovery_file"
  if [ "${#test_files[@]}" -gt 0 ]; then
    test_paths=$(_powershell_path_array "${test_files[@]}")
    echo "Running Pester tests..."
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-Pester -Path $test_paths -PassThru
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

  local test_files=()
  local source_files=()
  local discovery_file
  local path
  local test_paths
  local coverage_paths
  discovery_file=$(mktemp)
  _find_powershell_files "*.Tests.ps1" > "$discovery_file"
  # Discovery is line-delimited; filenames containing newlines are unsupported.
  while IFS= read -r path; do
    test_files[${#test_files[@]}]="$path"
  done < "$discovery_file"
  if [ "${#test_files[@]}" -gt 0 ]; then
    _find_powershell_files "*.ps1" | grep -v '\.Tests\.ps1$' > "$discovery_file"
    while IFS= read -r path; do
      source_files[${#source_files[@]}]="$path"
    done < "$discovery_file"
    rm -f "$discovery_file"
    test_paths=$(_powershell_path_array "${test_files[@]}")
    coverage_paths=$(_powershell_path_array "${source_files[@]}")
    echo "Running Pester with code coverage..."
    "$PWSH" -NoProfile -Command "
      \$results = Invoke-Pester -Path $test_paths -CodeCoverage $coverage_paths -PassThru
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
    rm -f "$discovery_file"
    echo "No Pester tests found for coverage measurement"
    return 0
  fi
}
