#!/usr/bin/env bats
# @test REQ-612
# @intent Gate 1's PowerShell branch has two ways to decide what to analyse, and only
#         one of them excludes vendored code.
#
#         With a scope file (`.xp-gate-powershell-analysis-paths`), analysis runs
#         per declared path. Without one — the default on every repo that has not
#         opted in — it falls back to:
#
#             Invoke-ScriptAnalyzer -Path . -Recurse -Severity Error,Warning
#
#         `-Recurse` from the repository root, with no exclusions. In a repo with
#         Playwright installed that means `node_modules/playwright-core/bin/*.ps1`
#         is analysed, and those files use Write-Host and WMI cmdlets by design. Gate
#         1 then blocks EVERY commit, permanently, with a message telling the author
#         to fix or suppress files that `npm ci` overwrites and they cannot edit.
#
#         The same adapter already gets this right elsewhere: its own `_find_powershell_files`
#         helper prunes `.git`, `node_modules`, `dist`, `coverage`, `.worktrees`,
#         `.delphi-work`, `.workbuddy`, `.sprint-state`, `wrc-drill` and the rest.
#         So one path in this file excludes vendored code and the other does not —
#         and the one without the exclusions is the one that runs by default.
#
#         A gate that can never pass is not a strict gate; it is a gate people learn
#         to bypass. This pins that the default path prunes the same trees.
# @covers AC-612-01, AC-612-02, AC-612-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
}

# The PowerShell snippet passed to Invoke-ScriptAnalyzer on the unscoped path.
legacy_recurse_line() {
  grep -n 'Invoke-ScriptAnalyzer -Path \. -Recurse' "$ADAPTER" || true
}

# ---------------------------------------------------------------------------
# AC-612-01: the default scan does not walk the whole tree unchecked
# ---------------------------------------------------------------------------

@test "AC-612-01: the default PowerShell analysis path does not recurse the repository root unchecked" {
  local hits
  hits=$(legacy_recurse_line)
  [ -z "$hits" ] || {
    echo "the unscoped path still runs a bare '-Path . -Recurse', which walks node_modules:"
    echo "$hits"
    return 1
  }
}

@test "AC-612-01: the default path still analyses the project's own scripts" {
  # The control, and the one that stops "fix the noise" from becoming "analyse
  # nothing". A gate that excludes everything passes forever; that is the exact
  # vacuous-pass shape this whole project keeps finding.
  #
  # The naive way to satisfy the case above is to delete the fallback. That would
  # turn Gate 1's PowerShell branch off on every repo without a scope file, which is
  # strictly worse than the bug. So the default must still produce a file list, and
  # it must be built from the pruned discovery the adapter already has.
  grep -q '_find_powershell_files' "$ADAPTER" || {
    echo "the adapter no longer has its pruned file discovery"
    return 1
  }
  local callers
  callers=$(grep -c '_find_powershell_files' "$ADAPTER" || true)
  [ "$callers" -ge 2 ] || {
    echo "_find_powershell_files exists but is only referenced $callers time(s); the default path does not use it"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-612-02: the pruned discovery really does exclude vendored trees
# ---------------------------------------------------------------------------

@test "AC-612-02: vendored and generated directory names appear in the prune list" {
  # Asserted on the prune list itself, because that list is the single source of
  # truth for "what this adapter refuses to analyse". If node_modules drops out of
  # it, every other consumer of the discovery silently changes scope too.
  local missing=""
  for name in .git node_modules dist coverage; do
    grep -q -- "-name $name" "$ADAPTER" || missing="$missing $name"
  done
  [ -z "$missing" ] || {
    echo "these directories are not pruned by the file discovery:$missing"
    return 1
  }
}

@test "AC-612-02: a Playwright-style vendored tree is not among the analysed files" {
  # End-to-end on the real helper: build a repo containing the exact shape the issue
  # reported (node_modules/playwright-core/bin/*.ps1) plus one genuine project script,
  # and assert the discovery returns only the project script.
  local work="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$work/node_modules/playwright-core/bin" "$work/scripts"
  printf 'Write-Host "vendored"\n' > "$work/node_modules/playwright-core/bin/install_webkit_wsl.ps1"
  printf 'Write-Host "vendored"\n' > "$work/node_modules/playwright-core/bin/reinstall_chrome_beta_win.ps1"
  printf 'Write-Output "project"\n' > "$work/scripts/run-xp-gate-native.ps1"

  run bash -c "
    cd '$work' || exit 1
    # Source the whole adapter: it only defines functions, and extracting a single
    # function with sed would stop at the first nested '}'.
    # shellcheck source=/dev/null
    source '$ADAPTER' >/dev/null 2>&1 || true
    _find_powershell_files '*.ps1'
  "
  [ "$status" -eq 0 ] || { echo "discovery failed: $output"; return 1; }
  [[ "$output" == *"run-xp-gate-native.ps1"* ]] || {
    echo "the project's own script must be analysed, got: $output"
    return 1
  }
  [[ "$output" != *"install_webkit_wsl.ps1"* ]] || {
    echo "a vendored node_modules script was collected for analysis: $output"
    return 1
  }
  [[ "$output" != *"reinstall_chrome_beta_win.ps1"* ]] || {
    echo "a vendored node_modules script was collected for analysis: $output"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-612-03: the adapter stays valid
# ---------------------------------------------------------------------------

@test "AC-612-03: the adapter is still syntactically valid" {
  run bash -n "$ADAPTER"
  [ "$status" -eq 0 ] || { echo "syntax error: $output"; return 1; }
  echo "XP_G1_REASON" >/dev/null
}
