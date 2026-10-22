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
#
# #547 finding 4: `command -v pwsh` alone is not enough. Under git-bash with a
# stripped PATH, the standard Windows installs are invisible even though the
# user can run pwsh from any terminal: pwsh 7 installs to
# %LOCALAPPDATA%\Microsoft\WindowsApps (a PATH alias that git-bash does not
# always inherit) and PS 5.1 lives at System32\WindowsPowerShell\v1.0. Probing
# those absolute paths converts a silent degrade into a working gate.
#
# The order is unchanged: whatever is on PATH wins, absolute paths are a
# fallback, and an empty result still means "not available" -- this widens
# detection, it does not invent an interpreter.
_detect_pwsh() {
  if command -v pwsh &>/dev/null 2>&1; then
    echo "pwsh"
    return 0
  fi
  if command -v powershell.exe &>/dev/null 2>&1; then
    echo "powershell.exe"
    return 0
  fi
  if command -v powershell &>/dev/null 2>&1; then
    echo "powershell"
    return 0
  fi
  # Windows absolute-path fallbacks.
  local candidate
  for candidate in \
    "${LOCALAPPDATA:-$HOME/AppData/Local}/Microsoft/WindowsApps/pwsh.exe" \
    "/c/Program Files/PowerShell/7/pwsh.exe" \
    "/c/Program Files/PowerShell/6/pwsh.exe" \
    "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" \
    "/mnt/c/Program Files/PowerShell/7/pwsh.exe" \
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo ""
  return 1
}

_find_powershell_files() {
  local name_pattern="$1"

  # #573: repo-local extra prune entries. The list below covers the artifact
  # directories xp-gate itself produces, but a consuming repo can have its own
  # (a generated obj/, a vendored third_party/, a samples/ tree of
  # intentionally broken scripts) and had no way to exclude them -- so its Gate 1
  # stayed the warning wall #538 fixed for xp-gate's own layout.
  #
  # Entries are appended to the built-in list, never replace it: `wrc-drill` is
  # pinned here for xp-gate's own admin drills. Matched by -name, so a listed
  # directory is pruned at any depth.
  #
  # Built as an ARRAY, not a string spliced into an eval: the entries come from
  # a file in the checked-out repo, and a directory name is not something to
  # hand to a shell parser.
  local -a prune_args=()
  local prune_file=".xp-gate-powershell-prune-dirs"
  if [ -f "$prune_file" ]; then
    local entry
    while IFS= read -r entry; do
      entry="${entry%$'\r'}"
      # Strip surrounding whitespace, then the ./ prefix and trailing / a repo
      # may reasonably write; -name matches a bare directory name.
      entry="${entry#"${entry%%[![:space:]]*}"}"
      entry="${entry%"${entry##*[![:space:]]}"}"
      case "$entry" in ''|'#'*) continue ;; esac
      entry="${entry#./}"
      entry="${entry%/}"
      [ -n "$entry" ] || continue
      prune_args[${#prune_args[@]}]=-o
      prune_args[${#prune_args[@]}]=-name
      prune_args[${#prune_args[@]}]="$entry"
    done < "$prune_file"
  fi

  # #538: gitignored drill/review artifact dirs hold hundreds of non-product
  # .ps1 files (admin drills, Delphi review copies). Collecting them turned
  # Gate 1 into an 800+ warning wall and made the pwsh gates unusable.
  find . \
    \( -type d \( \
      -name .git -o \
      -name node_modules -o \
      -name dist -o \
      -name coverage -o \
      -name .worktrees -o \
      -name .delphi-work -o \
      -name .workbuddy -o \
      -name .sprint-state -o \
      -name wrc-drill -o \
      -path './plugins/claude-code/skills' -o \
      -path './plugins/opencode/skills' -o \
      -path './plugins/qoder/skills' -o \
      -path './src/npm-package/skills' -o \
      -path './src/npm-package/plugins' \
      "${prune_args[@]+"${prune_args[@]}"}" \
    \) -prune \) -o \
    \( -type f -name "$name_pattern" -print \) 2>/dev/null
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
  if [ -n "$PWSH" ]; then
    local POWERSHELL_ARGS
    _powershell_invocation "$PWSH"
    echo "Running PSScriptAnalyzer static analysis on PowerShell scripts..."
    # Exit with non-zero if Error or Warning severity issues found
    local PSSA_RC=0
    local PSSA_OUT
    local scope_file=".xp-gate-powershell-analysis-paths"
    local analysis_targets=()

    # #571: repo-local analysis scope. Pester test files legitimately trip
    # dozens of rule warnings under the Pester execution model, so a whole-repo
    # scan either blocks every PowerShell commit or forces the rule set open —
    # both end in PowerShell not being gated at all. A repo may list its PRODUCT
    # scope (directories and/or single files, one per line, `#` comments) and
    # the SAME rules then apply to just that code.
    #
    # The load-bearing half is staleness: a listed path that no longer exists
    # means product code ESCAPED the gate (renamed, moved, or a new script added
    # without updating the file). That emits a reason so the pre-commit arm maps
    # it to WARN inside the scoring denominator, instead of silently analysing
    # less and reporting PASS. Same for a scope file with no usable entries.
    # Without the file the legacy whole-repo behavior is kept, so existing repos
    # are unaffected.
    if [ -f "$scope_file" ]; then
      local target_line
      local declared=0
      while IFS= read -r target_line; do
        target_line="${target_line%$'\r'}"
        # Strip surrounding whitespace before classifying: a line of spaces is
        # not a path, and `case` alone would treat it as one — measured, a
        # whitespace-only line became an "analysis path not found" entry.
        target_line="${target_line#"${target_line%%[![:space:]]*}"}"
        target_line="${target_line%"${target_line##*[![:space:]]}"}"
        case "$target_line" in ''|'#'*) continue ;; esac
        declared=$((declared + 1))
        if [ -e "$target_line" ]; then
          # shellcheck disable=SC2004  # explicit index arithmetic on an array
          analysis_targets[${#analysis_targets[@]}]="$target_line"
        else
          echo "  ℹ️  analysis path not found (skipped): $target_line"
          echo "XP_G1_REASON: analysis-path-missing:$target_line"
        fi
      done < "$scope_file"
      if [ "$declared" -eq 0 ]; then
        # The file exists but declares nothing: analysing zero paths would exit 0
        # and read as a clean PASS. A file whose entries are all MISSING takes
        # the per-entry branch above instead, so the two causes stay distinct.
        echo "XP_G1_REASON: analysis-paths-empty"
        echo "  ℹ️  $scope_file present but declares no paths - skipping analysis"
        return 3
      fi
    fi

    if [ "${#analysis_targets[@]}" -gt 0 ]; then
      # Scoped per-path run. -Path binds ONE string only (an array argument
      # throws "Cannot convert 'System.Object[]'..."), so each target is
      # analyzed separately and findings are aggregated.
      local target_array
      target_array=$(_powershell_path_array "${analysis_targets[@]}")
      PSSA_OUT=$("$PWSH" "${POWERSHELL_ARGS[@]}" "
        if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
          Write-Output 'PSSA_MODULE_MISSING'
          exit 0
        }
        # Non-terminating errors must become terminating: otherwise a broken
        # settings file or unreadable path yields an empty result set that LOOKS
        # like a clean pass.
        \$ErrorActionPreference = 'Stop'
        try { Import-Module PSScriptAnalyzer -ErrorAction Stop | Out-Null } catch { exit 3 }
        \$settings = Join-Path (Get-Location) 'PSScriptAnalyzerSettings.psd1'
        \$all = @()
        foreach (\$p in $target_array) {
          \$recurse = [System.IO.Directory]::Exists(\$p)
          if (Test-Path -LiteralPath \$settings) {
            \$all += @(Invoke-ScriptAnalyzer -Path \$p -Recurse:\$recurse -Severity Error,Warning -Settings \$settings -ErrorAction Stop)
          } else {
            \$all += @(Invoke-ScriptAnalyzer -Path \$p -Recurse:\$recurse -Severity Error,Warning -ErrorAction Stop)
          }
        }
        if (\$all) {
          \$all | Format-Table -AutoSize
          exit 1
        }
        exit 0
      " 2>&1) || PSSA_RC=$?
    else
      PSSA_OUT=$("$PWSH" "${POWERSHELL_ARGS[@]}" "
        if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
          Write-Output 'PSSA_MODULE_MISSING'
          exit 0
        }
        \$results = Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning
        if (\$results) {
          \$results | Format-Table -AutoSize
          exit 1
        }
        exit 0
      " 2>&1) || PSSA_RC=$?
    fi

    printf '%s\n' "$PSSA_OUT"
    case "$PSSA_RC" in
      0)
        if printf '%s\n' "$PSSA_OUT" | grep -q 'PSSA_MODULE_MISSING'; then
          # #547 finding 2: the engine exists but its module does not. That is
          # NOT a pass -- nothing was analysed. The XP_G1_REASON protocol (the
          # one the java branch uses) turns this into a WARN that stays in the
          # scoring denominator instead of vanishing.
          echo "XP_G1_REASON: PSScriptAnalyzer module not installed (Install-Module PSScriptAnalyzer)"
          return 3
        fi
        return 0
        ;;
      1)
        return 1   # real findings -> BLOCK upstream
        ;;
      *)
        echo "XP_G1_REASON: PSScriptAnalyzer run failed (exit $PSSA_RC)"
        return 2   # unusable -> fail closed upstream
        ;;
    esac
  else
    # #547 finding 4: previously `return 0`, i.e. "no PowerShell available"
    # was indistinguishable from "PowerShell is clean" -- a silent false pass on
    # a PowerShell commit. Return the not-available verdict so the caller can
    # WARN and record a reason.
    echo "PowerShell executable not found (probe: pwsh, powershell.exe, and the standard Windows install paths)"
    echo "XP_G1_REASON: pwsh not available (install PowerShell 7: https://aka.ms/powershell)"
    return 3
  fi
}

run_lint() {
  # PSScriptAnalyzer covers both static analysis and linting
  run_static_analysis
}

# Timeout guard for Pester runs.
# A hanging Pester test (e.g. a test that dot-sources a script whose body performs
# WMI/registry/scheduled-task scans) would otherwise block `git commit` forever.
# Default 300s, override via XP_GATE_POWERSHELL_TEST_TIMEOUT_S.
_pester_timeout() {
  local default_s="${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-300}"
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
      echo "⚠️  Pester tests TIMED OUT after ${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-300}s (may be hanging)."
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
    _find_powershell_files "*.ps1" | grep -v '\.Tests\.ps1$' > "$discovery_file"
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
          # skip blanks and comments
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
      echo "⚠️  Pester coverage TIMED OUT after ${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-300}s (may be hanging)."
      return 1
    fi
    return $cov_exit
  else
    rm -f "$discovery_file"
    echo "No Pester tests found for coverage measurement"
    return 0
  fi
}
