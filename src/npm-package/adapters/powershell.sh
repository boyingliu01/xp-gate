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
#
# ============================================================================
# v2026-10-16/17 HARDENING (batch 3 + R6 confirmations)
#
# This file carries the fail-closed hardening for PowerShell projects. The
# canonical copy for THIS project lives in the repo at githooks/adapters/
 # powershell.sh; the consistency tests in tests/unit/platform-hygiene.Tests.ps1
# hash-compare the live file against the vendored copy, so a silent revert of
# this file (observed 2026-10-17: an external xp-gate maintenance process
# restored a legacy version, preserving the old mtime) turns the repo suite
# RED instead of silently downgrading the gates.
#
# Fail-closed semantics (consumed by the pre-commit powershell branch):
#   - engine missing           -> stdout "XP_G1_REASON: powershell-engine-unavailable", exit 0 (WARN)
#   - PSSA module missing      -> stdout "XP_G1_REASON: psscriptanalyzer-unavailable", exit 0 (WARN)
#   - scope file has no valid
#     entries                  -> stdout "XP_G1_REASON: analysis-paths-empty", exit 0 (WARN)
#   - scope entry not on disk  -> stdout "XP_G1_REASON: analysis-path-missing:<path>", exit 0 (WARN)
#   - findings                 -> findings table, exit 1 (BLOCK)
#   - clean                    -> exit 0 (PASS)
# A reason on stdout with exit 0 maps to WARN in the pre-commit powershell
# branch (WARN counts in the score denominator - never a silent PASS).
# ============================================================================

# Detect PowerShell executable (prefer pwsh 7+, fallback to powershell.exe 5.1).
# v2026-10-16: PATH-only detection missed the standard Windows installs when
# git-bash PATH is stripped (pwsh lives in WindowsApps, powershell.exe is
# always at the System32 absolute path). Probe by exit code, never by stdout.
_detect_pwsh() {
  if command -v pwsh >/dev/null 2>&1; then
    echo "pwsh"
    return 0
  fi
  local winapp="${LOCALAPPDATA:-$HOME/AppData/Local}/Microsoft/WindowsApps/pwsh.exe"
  if [ -f "$winapp" ]; then
    echo "$winapp"
    return 0
  fi
  if command -v powershell.exe >/dev/null 2>&1; then
    echo "powershell.exe"
    return 0
  fi
  local sysps="${WINDIR:-C:/Windows}/System32/WindowsPowerShell/v1.0/powershell.exe"
  if [ -f "$sysps" ]; then
    echo "$sysps"
    return 0
  fi
  echo ""
}

# File discovery. v2026-10-16: prune list = xp-gate scaffold dot directories
# + project-injected entries from .xp-gate-powershell-prune-dirs (one dir per
# line, relative to repo root). Without this, drill/scaffold scripts dilute
# test discovery AND the coverage denominator (xp-gate issue #538).
# 2026-10-20: merged upstream v0.19+ prune additions (plugins/*/skills and
# src/npm-package/* — xp-gate's own repo layout; harmless no-ops elsewhere)
# so the vendored copy stays a superset of the upstream discovery list.
_find_powershell_files() {
  local name_pattern="$1"
  local prune_file=".xp-gate-powershell-prune-dirs"
  local args=()
  args+=(find . "(" -type d "(" -name .git -o -name node_modules -o -name dist -o -name coverage -o -name .worktrees -o -name .workbuddy -o -name .sprint-state -o -name .delphi-work -o -name .qoder -o -name .vscode -o -name .idea -o -name .xp-gate)
  local dir
  if [ -f "$prune_file" ]; then
    while IFS= read -r dir; do
      case "$dir" in ''|'#'*) continue ;; esac
      dir="${dir%$'\r'}"
      dir="${dir#./}"
      dir="${dir%/}"
      args+=(-o -name "$dir")
    done < "$prune_file"
  fi
  # Upstream v0.19+ additions (path-anchored, xp-gate-repo-specific).
  args+=(-o -path './plugins/claude-code/skills' -o -path './plugins/opencode/skills' -o -path './plugins/qoder/skills' -o -path './src/npm-package/skills' -o -path './src/npm-package/plugins')
  args+=(")" -prune ")" -o "(" -type f -name "$name_pattern" -print ")")
  "${args[@]}" 2>/dev/null
}

_powershell_invocation() {
  local executable="$1"
  POWERSHELL_ARGS=(-NoProfile)
  case "${executable##*/}" in
    powershell.exe|powershell)
      POWERSHELL_ARGS[${#POWERSHELL_ARGS[@]}]=-ExecutionPolicy
      POWERSHELL_ARGS[${#POWERSHELL_ARGS[@]}]=Bypass
      ;;
  esac
  POWERSHELL_ARGS[${#POWERSHELL_ARGS[@]}]=-Command
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
  if [ -z "$PWSH" ]; then
    # Fail closed: "tool absent" is a degraded verification, not a pass. The
    # pre-commit powershell branch maps this reason to WARN (in denominator).
    echo "XP_G1_REASON: powershell-engine-unavailable"
    echo "  ℹ️  PowerShell engine not found (PATH + standard installs probed) - quality NOT verified"
    return 0
  fi

  local POWERSHELL_ARGS
  _powershell_invocation "$PWSH"

  # Scoped mode: the repo's .xp-gate-powershell-analysis-paths lists the
  # PRODUCT scope (directories and/or single files). Rationale: Pester test
  # files legitimately trip dozens of rule warnings under the Pester execution
  # model, which would make a whole-repo scan either block everything or be
  # disabled entirely. Scope file narrows the gate to product code under the
  # SAME rules (repo-root PSScriptAnalyzerSettings.psd1), and missing entries
  # fail closed (R6): a scope entry that vanished means product code escaped
  # the gate. Without the scope file the legacy whole-repo behavior is kept.
  local analysis_targets=()
  local scope_file=".xp-gate-powershell-analysis-paths"
  local target_line
  if [ -f "$scope_file" ]; then
    while IFS= read -r target_line; do
      target_line="${target_line%$'\r'}"
      case "$target_line" in ''|'#'*) continue ;; esac
      if [ -e "$target_line" ]; then
        analysis_targets[${#analysis_targets[@]}]="$target_line"
      else
        echo "  ℹ️  analysis path not found (skipped): $target_line"
        # v2026-10-17 R6 hardening: a listed-but-missing path means product
        # code ESCAPED the analysis scope (renamed/moved/new script added
        # without updating the scope file). That must NOT pass silently -
        # emit a reason so the pre-commit powershell branch maps to WARN
        # (fail-closed), matching the analysis-paths-empty semantics.
        echo "XP_G1_REASON: analysis-path-missing:$target_line"
      fi
    done < "$scope_file"
    if [ "${#analysis_targets[@]}" -eq 0 ]; then
      echo "XP_G1_REASON: analysis-paths-empty"
      echo "  ℹ️  $scope_file present but no existing paths - skipping analysis"
      return 0
    fi
  fi

  # Module availability is probed by EXIT CODE, never by parsing stdout:
  # a stderr line like "not recognized" is message text, not a verdict.
  # The scoped fragment also imports the module explicitly (with -ErrorAction
  # Stop) so a cold autoload hiccup cannot be misread as "0 findings".
  local module_probe_rc=0
  "$PWSH" "${POWERSHELL_ARGS[@]}" '
    try { Import-Module PSScriptAnalyzer -ErrorAction Stop; exit 0 }
    catch { exit 1 }
  ' >/dev/null 2>&1 || module_probe_rc=$?
  if [ "$module_probe_rc" -ne 0 ]; then
    echo "XP_G1_REASON: psscriptanalyzer-unavailable"
    echo "  ℹ️  PSScriptAnalyzer module not importable - quality NOT verified (Install-Module PSScriptAnalyzer -Scope CurrentUser)"
    return 0
  fi

  echo "Running PSScriptAnalyzer static analysis on PowerShell scripts..."

  if [ "${#analysis_targets[@]}" -gt 0 ]; then
    # Scoped per-path run. -Path binds ONE string only (an array argument
    # throws "Cannot convert 'System.Object[]'..."), so each target is
    # analyzed separately and the findings are aggregated. Non-terminating
    # errors inside the fragment must be terminating ($ErrorActionPreference
    # = 'Stop'): otherwise a broken settings file or unreadable path yields
    # an empty result set that LOOKS like a clean pass.
    local target_array
    target_array=$(_powershell_path_array "${analysis_targets[@]}")
    "$PWSH" "${POWERSHELL_ARGS[@]}" "
      \$ErrorActionPreference = 'Stop'
      try { Import-Module PSScriptAnalyzer -ErrorAction Stop | Out-Null } catch { exit 3 }
      \$settings = Join-Path (Get-Location) 'PSScriptAnalyzerSettings.psd1'
      \$all = @()
      foreach (\$p in $target_array) {
        \$recurse = [System.IO.Directory]::Exists(\$p)
        if (Test-Path -LiteralPath \$settings) {
          \$all += @(Invoke-ScriptAnalyzer -Path \$p -Recurse:\$recurse -Settings \$settings -ErrorAction Stop)
        } else {
          \$all += @(Invoke-ScriptAnalyzer -Path \$p -Recurse:\$recurse -ErrorAction Stop)
        }
      }
      if (\$all) {
        \$all | Format-Table -AutoSize
        exit 1
      }
      exit 0
    "
    local scoped_rc=$?
    if [ "$scoped_rc" -eq 3 ]; then
      echo "XP_G1_REASON: psscriptanalyzer-unavailable"
      echo "  ℹ️  PSScriptAnalyzer import failed inside scoped fragment - quality NOT verified"
      return 0
    fi
    return $scoped_rc
  fi

  # Legacy whole-repo behavior (no scope file): recursively analyze all .ps1
  # files from repo root; exit non-zero on Error/Warning findings.
  "$PWSH" "${POWERSHELL_ARGS[@]}" "
    \$results = Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning
    if (\$results) {
      \$results | Format-Table -AutoSize
      exit 1
    }
    exit 0
  "
  return $?
}

run_lint() {
  # PSScriptAnalyzer covers both static analysis and linting
  run_static_analysis
}

# Timeout guard for Pester runs.
# A hanging Pester test (e.g. a test that dot-sources a script whose body performs
# WMI/registry/scheduled-task scans) would otherwise block `git commit` forever.
# Default 900s (v2026-10-16 hardening: a full 750+-test suite plus a second
# instrumented coverage run needs more headroom than the old 300s), override
# via XP_GATE_POWERSHELL_TEST_TIMEOUT_S.
_pester_timeout() {
  local default_s="${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-900}"
  # Prefer GNU timeout (Git Bash / Linux). On Windows where `timeout` resolves to
  # the native timeout.exe, fall back to running without a hard timeout.
  if command -v timeout >/dev/null 2>&1 && timeout --version 2>/dev/null | grep -qi "coreutils"; then
    timeout "${default_s}s" "$@"
  else
    "$@"
  fi
}

run_tests() {
  local PWSH
  PWSH=$(_detect_pwsh)
  if [ -z "$PWSH" ]; then
    echo "PowerShell not available, skipping PowerShell tests"
    return 0
  fi

  local POWERSHELL_ARGS
  _powershell_invocation "$PWSH"

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
    _pester_timeout "$PWSH" "${POWERSHELL_ARGS[@]}" "
      \$results = Invoke-Pester -Path $test_paths -PassThru
      if (\$results.FailedCount -gt 0) {
        Write-Host \"FAILED: \$(\$results.FailedCount) test(s)\"
        exit 1
      }
      Write-Host \"PASSED: \$(\$results.PassedCount) test(s)\"
      exit 0
    "
    local run_exit=$?
    if [ "$run_exit" = "124" ]; then
      echo "⚠️  Pester tests TIMED OUT after ${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-900}s (may be hanging)."
      echo "    A test may be blocking on a system call (WMI/registry/scheduled-task)."
      echo "    Fix the hanging test, or set XP_GATE_POWERSHELL_TEST_TIMEOUT_S to a higher value."
      return 1
    fi
    return $run_exit
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

  local POWERSHELL_ARGS
  _powershell_invocation "$PWSH"

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
    # `|| true`: grep -v exits 1 when every discovered path is a test file
    # (nothing left); the redirected assignment would abort a set -e consumer.
    _find_powershell_files "*.ps1" | grep -v '\.Tests\.ps1$' > "$discovery_file" || true
    while IFS= read -r path; do
      source_files[${#source_files[@]}]="$path"
    done < "$discovery_file"
    rm -f "$discovery_file"

    # Optional project-level exclusions. Some scripts cannot be instrumented or
    # exercised by a unit-test runner at all (e.g. a bootstrap script whose Main
    # ends in `exit`, which terminates the Pester host when invoked in-process).
    # Counting them as 0% coverage permanently caps the achievable percentage and
    # makes the threshold unsatisfiable no matter how good the suite is.
    # Format: one glob per line in .xp-gate-powershell-coverage-ignore
    # NOTE (2026-10-16): with the discovery prune above covering the scaffold
    # and drill directories, this list is EMPTY for this project - the coverage
    # denominator is the true product file list, and per-artifact subtraction
    # from it is forbidden (enforced by the repo's gate-boundary tests).
    local ignore_file=".xp-gate-powershell-coverage-ignore"
    if [ -f "$ignore_file" ]; then
      local filtered=()
      local src
      for src in "${source_files[@]}"; do
        local skip=0
        local pat
        # Discovery yields paths like "./setup.ps1"; match the pattern against the
        # raw path AND the "./"-stripped form so a plain "setup.ps1" glob works.
        local src_norm="${src#./}"
        while IFS= read -r pat; do
          # skip blanks and comments; strip CR (same CRLF discipline as the
          # scope/prune readers - a trailing \r would silently never match)
          pat="${pat%$'\r'}"
          case "$pat" in ''|'#'*) continue ;; esac
          local pat_norm="${pat#./}"
          # shellcheck disable=SC2254
          case "$src" in $pat|$pat_norm) skip=1; break ;; esac
          # shellcheck disable=SC2254
          case "$src_norm" in $pat_norm) skip=1; break ;; esac
        done < "$ignore_file"
        if [ "$skip" -eq 0 ]; then
          filtered[${#filtered[@]}]="$src"
        else
          echo "  ℹ️  Coverage exclusion matched: $src"
        fi
      done
      # Assign back unconditionally: when EVERY source file matched an
      # exclusion, `filtered` is empty and the check below must see 0 to skip
      # coverage. Only assigning on >0 silently ignored a full exclusion.
      # (Empty-array guards keep this bash-3.2 / `set -u` safe.)
      if [ "${#filtered[@]}" -gt 0 ]; then
        source_files=("${filtered[@]}")
      else
        source_files=()
      fi
    fi

    if [ "${#source_files[@]}" -eq 0 ]; then
      echo "No PowerShell source files left after exclusions, skipping coverage"
      return 0
    fi

    test_paths=$(_powershell_path_array "${test_files[@]}")
    coverage_paths=$(_powershell_path_array "${source_files[@]}")
    echo "Running Pester with code coverage..."
    # Pester 5 requires the modern configuration object: `-Path ... -CodeCoverage ...`
    # is the deprecated Pester 4 parameter set and fails outright on Pester 5.x
    # ("cannot resolve parameter set"). Using it silently produced no coverage.xml,
    # which the pre-commit hook then reported as an unparseable/zero result.
    _pester_timeout "$PWSH" "${POWERSHELL_ARGS[@]}" "
      \$cfg = New-PesterConfiguration
      \$cfg.Run.Path = $test_paths
      \$cfg.CodeCoverage.Enabled = \$true
      \$cfg.CodeCoverage.Path = $coverage_paths
      \$cfg.CodeCoverage.OutputFormat = 'JaCoCo'
      \$cfg.CodeCoverage.OutputPath = (Join-Path (Get-Location) 'coverage.xml')
      \$cfg.Run.PassThru = \$true
      \$results = Invoke-Pester -Configuration \$cfg
      \$pct = [math]::Round(\$results.CodeCoverage.CoveragePercent, 1)
      Write-Host \"Coverage: \$pct%\"
      exit 0
    " 2>&1
    local cov_exit=$?
    if [ "$cov_exit" = "124" ]; then
      echo "⚠️  Pester coverage TIMED OUT after ${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-900}s (may be hanging)."
      return 1
    fi
    return $cov_exit
  else
    rm -f "$discovery_file"
    echo "No Pester tests found for coverage measurement"
    return 0
  fi
}
