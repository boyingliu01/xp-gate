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
  # #538: gitignored drill/review artifact dirs hold hundreds of non-product
  # .ps1 files (admin drills, Delphi review copies). Collecting them turned
  # Gate 1 into an 800+ warning wall and made the pwsh gates unusable.
  #
  # #549: the built-in list can only know directories that exist in THIS repo
  # (`-name wrc-drill` was hardcoded for one consumer). A consuming repo's own
  # scaffolding is unknowable here, so it is read from
  # .xp-gate-powershell-prune-dirs: one directory NAME per line ('#' comments
  # and blank lines ignored, matched anywhere in the tree like the built-ins).
  # Without this hook every consumer has to patch the shared adapter or accept
  # non-product files in its test/coverage/analysis denominators.
  #
  # Entries are validated as bare directory NAMES. Discovery feeds the test
  # discovery, coverage denominator and analysis scope alike, so an entry like
  # '*' or a path with a separator would silently shrink all three while the
  # config file still looked reasonable (code walkthrough round 1, finding A3).
  # A rejected entry is reported and ignored -- never silently honoured.
  local prune_args=()
  local prune_dir
  local prune_file=".xp-gate-powershell-prune-dirs"
  if [ -f "$prune_file" ]; then
    while IFS= read -r prune_dir; do
      prune_dir="${prune_dir#$'\xEF\xBB\xBF'}"
      prune_dir="${prune_dir%$'\r'}"
      case "$prune_dir" in ''|'#'*) continue ;; esac
      case "$prune_dir" in
        */*|*\\*|*'*'*|*'?'*|*'['*)
          echo "  ⚠️  $prune_file: ignoring invalid entry '$prune_dir' (must be a bare directory name, no separators or glob metacharacters)"
          continue
          ;;
        .|..)
          echo "  ⚠️  $prune_file: ignoring invalid entry '$prune_dir'"
          continue
          ;;
      esac
      echo "  ℹ️  pruning directory name '$prune_dir' (from $prune_file)"
      prune_args[${#prune_args[@]}]=-name
      prune_args[${#prune_args[@]}]="$prune_dir"
      prune_args[${#prune_args[@]}]=-o
    done < "$prune_file"
  fi
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
      -name .xp-gate -o \
      -name .vscode -o \
      -name .idea -o \
      -name .qoder -o \
      "${prune_args[@]}" \
      -path './plugins/claude-code/skills' -o \
      -path './plugins/opencode/skills' -o \
      -path './plugins/qoder/skills' -o \
      -path './src/npm-package/skills' -o \
      -path './src/npm-package/plugins' \
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

    # #549: scoped mode. .xp-gate-powershell-analysis-paths lists the PRODUCT
    # scope (directories and/or single files, one per line). Rationale: Pester
    # test files legitimately trip dozens of rule warnings under the Pester
    # execution model (unused mocks, global fixtures, deliberate negative
    # cases), so a whole-tree scan forces consumers into an impossible choice:
    # block every commit, or relax the rules for the product code as well. The
    # scope file narrows the gate to product code under the SAME rules and the
    # repo-root PSScriptAnalyzerSettings.psd1.
    #
    # A listed-but-missing path means product code ESCAPED the scope (renamed,
    # moved, or a new script added without updating the file). That is emitted
    # as XP_G1_REASON: analysis-path-missing:<path> and maps to WARN -- counted
    # in the denominator, never a silent pass, matching the missing-module arm.
    # The count is tracked in a variable, NOT acted on inline: the verdict is
    # decided after the analysis run, because a reason line alone would be
    # stripped by the parent's `grep -v '^XP_G1_REASON: '` and the run would
    # still report PASSED (found in code walkthrough round 1: one valid path
    # plus one ghost path returned 0).
    #
    # Without the file the legacy whole-tree behavior is kept unchanged, so
    # existing repos are unaffected by this addition.
    local analysis_targets=()
    local scope_file=".xp-gate-powershell-analysis-paths"
    local target_line
    local scope_missing=0
    local scope_declared=0
    local scoped_mode=0
    if [ -f "$scope_file" ]; then
      scoped_mode=1
      while IFS= read -r target_line; do
        # A UTF-8 BOM (PowerShell 5.1 `Set-Content -Encoding UTF8` writes one)
        # would otherwise glue itself to the first entry and turn the
        # documented '#' header into a path.
        target_line="${target_line#$'\xEF\xBB\xBF'}"
        target_line="${target_line%$'\r'}"
        case "$target_line" in ''|'#'*) continue ;; esac
        scope_declared=$((scope_declared + 1))
        if [ -e "$target_line" ]; then
          analysis_targets[${#analysis_targets[@]}]="$target_line"
        else
          echo "  ⚠️  analysis path not found: $target_line"
          echo "XP_G1_REASON: analysis-path-missing:$target_line"
          scope_missing=$((scope_missing + 1))
        fi
      done < "$scope_file"
    fi

    # Scoped mode with nothing analysable is not a pass: either every entry is
    # missing, or the file declares no usable entry at all. Both mean product
    # code is outside the gate.
    if [ "$scoped_mode" -eq 1 ] && [ "${#analysis_targets[@]}" -eq 0 ]; then
      if [ "$scope_declared" -eq 0 ]; then
        echo "XP_G1_REASON: analysis-paths-empty"
        echo "  ℹ️  $scope_file declares no paths - nothing to analyse"
      else
        echo "  ℹ️  $scope_file declares $scope_declared path(s), none exist - nothing to analyse"
      fi
      return 3
    fi

    # The settings file is part of the contract: Invoke-ScriptAnalyzer -Settings
    # on a missing path is a non-terminating error, so with SilentlyContinue the
    # fragment returns zero findings and the gate reports PASSED on an
    # unanalysed tree (code walkthrough round 1, finding A4). Require it before
    # spending the run.
    if [ "$scoped_mode" -eq 1 ] && [ ! -f "PSScriptAnalyzerSettings.psd1" ]; then
      echo "XP_G1_REASON: analysis-settings-missing:PSScriptAnalyzerSettings.psd1"
      echo "  ⚠️  $scope_file is in use but PSScriptAnalyzerSettings.psd1 is absent - refusing to analyse with an unknown rule set"
      return 3
    fi

    echo "Running PSScriptAnalyzer static analysis on PowerShell scripts..."
    local PSSA_RC=0
    local PSSA_OUT
    local scope_body
    if [ "${#analysis_targets[@]}" -gt 0 ]; then
      # -ErrorAction Stop, not SilentlyContinue: an analyzer error (unreadable
      # file, bad settings, a path that vanished between the -e test and the
      # run) must become a fail-closed verdict, not an empty result set that
      # reads as clean. The findings themselves are returned, not errors.
      scope_body="foreach (\$t in $(_powershell_path_array "${analysis_targets[@]}")) { Invoke-ScriptAnalyzer -Path \$t -Recurse -Severity Error,Warning -Settings PSScriptAnalyzerSettings.psd1 -ErrorAction Stop }"
    else
      # Recursively analyze all .ps1 files from repo root
      scope_body="Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning"
    fi
    PSSA_OUT=$("$PWSH" "${POWERSHELL_ARGS[@]}" "
      if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
        Write-Output 'PSSA_MODULE_MISSING'
        exit 0
      }
      # Import explicitly: a cold autoload hiccup must not be misread as
      # '0 findings'. Exit codes are the verdict, never parsed stdout.
      try { Import-Module PSScriptAnalyzer -ErrorAction Stop }
      catch { Write-Output 'PSSA_MODULE_MISSING'; exit 0 }
      try {
        \$results = $scope_body
      } catch {
        Write-Output ('PSSA_RUN_ERROR: ' + \$_.Exception.Message)
        exit 3
      }
      if (\$results) {
        \$results | Format-Table -AutoSize
        exit 1
      }
      exit 0
    " 2>&1) || PSSA_RC=$?
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
        # A missing scope entry stays a WARN even when the rest of the scope
        # analysed cleanly. The reason line is emitted above; this return is
        # what makes it count (the parent strips the line from display but
        # keeps the verdict in the denominator).
        if [ "$scope_missing" -gt 0 ]; then
          echo "  ⚠️  $scope_missing scope entry(ies) did not exist - product code may have escaped the gate"
          return 3
        fi
        return 0
        ;;
      1)
        # Real findings already BLOCK, so the missing-scope signal cannot change
        # the verdict here -- but it must not be dropped either: "there are lint
        # findings AND a product path escaped the gate" is strictly more
        # information than "there are lint findings". Emit it so the operator
        # fixes the scope in the same pass (code walkthrough round 2).
        if [ "$scope_missing" -gt 0 ]; then
          echo "  ⚠️  $scope_missing scope entry(ies) did not exist - product code may have escaped the gate (in addition to the findings above)"
        fi
        return 1   # real findings -> BLOCK upstream
        ;;
      3)
        echo "XP_G1_REASON: PSScriptAnalyzer raised an error during the run"
        printf '%s\n' "$PSSA_OUT" | grep '^PSSA_RUN_ERROR: ' | sed 's/^PSSA_RUN_ERROR: //' | head -3 | while IFS= read -r _line; do echo "  ⚠️  $_line"; done
        return 3   # analysis error -> fail closed as WARN
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
