#!/usr/bin/env bats

# ============================================================================
# Issue #549: PowerShell analysis scope + prune list, and the fail-open holes
# found in code walkthrough round 1.
#
# The first cut of this feature emitted XP_G1_REASON: analysis-path-missing
# but still returned 0 when at least one other scope entry existed. The parent
# strips reason lines from display (`grep -v '^XP_G1_REASON: '`) and keys the
# verdict off the exit code, so the run reported "PASSED - PowerShell code
# quality" while a product path had escaped the gate. Same shape for a missing
# PSScriptAnalyzerSettings.psd1: -ErrorAction SilentlyContinue turned the
# analyzer error into an empty result set that read as clean.
#
# Every case below pins a fail-closed verdict. The pair "valid entry -> 0" /
# "valid entry + ghost entry -> 3" is the regression that matters most: a
# missing entry must not be masked by a clean analysis of the rest.
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
  ADAPTER="$BATS_TEST_DIRNAME/../adapters/powershell.sh"
  mkdir -p product
  cat > product/a.ps1 <<'EOF'
function Get-Thing { return 1 }
EOF
  cat > PSScriptAnalyzerSettings.psd1 <<'EOF'
@{ Severity = @('Error', 'Warning') }
EOF
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Runs run_static_analysis in a subshell and prints its exit code.
# The adapter is dot-sourced so the helper functions are in scope; stdout is
# discarded because the verdict is the exit code, never parsed output.
adapter_verdict() {
  (
    # shellcheck disable=SC1090
    . "$ADAPTER"
    run_static_analysis >/dev/null 2>&1
  )
  echo $?
}

# ---------------------------------------------------------------------------
# A1 (critical): a missing scope entry must fail closed even when the rest of
# the scope analyses cleanly.
# ---------------------------------------------------------------------------

@test "scope: all entries exist -> PASS (0)" {
  printf 'product\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 0 ]
}

@test "scope: one valid + one missing entry -> WARN (3), not a silent PASS" {
  printf 'product\nghost-path\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 3 ]
}

@test "scope: one valid + one missing entry still emits the reason line" {
  printf 'product\nghost-path\n' > .xp-gate-powershell-analysis-paths
  run env -i PATH="$PATH" HOME="$HOME" bash -c ". '$ADAPTER'; run_static_analysis 2>&1"
  [ "$status" -eq 3 ]
  [[ "$output" == *"XP_G1_REASON: analysis-path-missing:ghost-path"* ]]
}

# ---------------------------------------------------------------------------
# A2: a scope that resolves to nothing analysable is not a pass.
# ---------------------------------------------------------------------------

@test "scope: only missing entries -> WARN (3)" {
  printf 'ghost-only\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 3 ]
}

@test "scope: file with comments and blank lines only -> WARN (3)" {
  printf '# nothing here\n\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 3 ]
}

# ---------------------------------------------------------------------------
# A4: the settings file is part of the contract in scoped mode.
# ---------------------------------------------------------------------------

@test "scope: missing PSScriptAnalyzerSettings.psd1 -> WARN (3), not PASS" {
  printf 'product\n' > .xp-gate-powershell-analysis-paths
  rm -f PSScriptAnalyzerSettings.psd1
  [ "$(adapter_verdict)" -eq 3 ]
}

@test "scope: missing settings file reports analysis-settings-missing" {
  printf 'product\n' > .xp-gate-powershell-analysis-paths
  rm -f PSScriptAnalyzerSettings.psd1
  run env -i PATH="$PATH" HOME="$HOME" bash -c ". '$ADAPTER'; run_static_analysis 2>&1"
  [ "$status" -eq 3 ]
  [[ "$output" == *"XP_G1_REASON: analysis-settings-missing"* ]]
}

# ---------------------------------------------------------------------------
# A5: a UTF-8 BOM must not glue itself to the first entry. PowerShell 5.1
# writes one for `Set-Content -Encoding UTF8`, so this is the default shape a
# Windows user produces.
# ---------------------------------------------------------------------------

@test "scope: BOM-prefixed first entry is still usable -> PASS (0)" {
  printf '\xEF\xBB\xBFproduct\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 0 ]
}

@test "prune: BOM-prefixed first entry still prunes" {
  mkdir -p scaffold
  printf 'function B { return 1 }\n' > scaffold/b.ps1
  printf '\xEF\xBB\xBFscaffold\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" != *"scaffold/b.ps1"* ]]
}

# ---------------------------------------------------------------------------
# A3: prune entries are validated. Discovery feeds the test-discovery,
# coverage and analysis denominators, so an entry like '*' would silently
# shrink all three while the config file still looked reasonable.
# ---------------------------------------------------------------------------

@test "prune: a glob entry is rejected and cannot blank out discovery" {
  printf '*\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" == *"product/a.ps1"* ]]
  [[ "$output" == *"ignoring invalid entry '*'"* ]]
}

@test "prune: an entry containing a path separator is rejected" {
  printf 'product/../product\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" == *"product/a.ps1"* ]]
  [[ "$output" == *"ignoring invalid entry"* ]]
}

@test "prune: a bare directory name is honoured and announced" {
  mkdir -p scaffold
  printf 'function B { return 1 }\n' > scaffold/b.ps1
  printf 'scaffold\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" != *"scaffold/b.ps1"* ]]
  [[ "$output" == *"pruning directory name 'scaffold'"* ]]
}

@test "prune: '.' and '..' are rejected" {
  printf '.\n..\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" == *"product/a.ps1"* ]]
}

# ---------------------------------------------------------------------------
# Backwards compatibility: with no config files present the legacy whole-tree
# behavior must be byte-for-byte unchanged.
# ---------------------------------------------------------------------------

@test "no scope file: discovery is unchanged (whole tree)" {
  mkdir -p nested/deep
  printf 'function C { return 1 }\n' > nested/deep/c.ps1
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" == *"product/a.ps1"* ]]
  [[ "$output" == *"nested/deep/c.ps1"* ]]
}

@test "no scope file: adapter still passes on a clean product tree" {
  [ "$(adapter_verdict)" -eq 0 ]
}

# ---------------------------------------------------------------------------
# CRLF: the config files may be written on Windows with CRLF endings. A
# trailing CR would otherwise become part of the path/name.
# ---------------------------------------------------------------------------

@test "scope: CRLF line endings do not break entry resolution" {
  printf 'product\r\n' > .xp-gate-powershell-analysis-paths
  [ "$(adapter_verdict)" -eq 0 ]
}

@test "prune: CRLF line endings do not break pruning" {
  mkdir -p scaffold
  printf 'function B { return 1 }\n' > scaffold/b.ps1
  printf 'scaffold\r\n' > .xp-gate-powershell-prune-dirs
  # shellcheck disable=SC1090
  run bash -c ". '$ADAPTER'; _find_powershell_files '*.ps1'"
  [[ "$output" != *"scaffold/b.ps1"* ]]
}

# ---------------------------------------------------------------------------
# The mirror under src/npm-package must stay byte-identical (the pre-push
# mirror gate enforces this repo-wide; pinning it here localises a failure).
# ---------------------------------------------------------------------------

@test "mirror: adapters/powershell.sh is identical under src/npm-package" {
  run diff "$BATS_TEST_DIRNAME/../adapters/powershell.sh" \
           "$BATS_TEST_DIRNAME/../../src/npm-package/adapters/powershell.sh"
  [ "$status" -eq 0 ]
}
