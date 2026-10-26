#!/usr/bin/env bats
# @test REQ-620 Gate 1 sees .psm1 module files
# @intent run_static_analysis discovered its targets with a hardcoded '*.ps1'
#         glob, so a .psm1 module file was invisible to PSScriptAnalyzer. A repo
#         whose PowerShell code lives in modules -- the normal layout for
#         anything that ships one -- therefore got, on every commit:
#
#             ⚠️  WARN - PowerShell code quality NOT verified:
#                 no PowerShell files found outside the pruned directories
#
#         and no violation in those modules could block.
#
#         The message is the crueller half. `_find_powershell_files` returned
#         empty, and the adapter correctly refused to call that a pass (#537),
#         but it attributed the emptiness to PRUNING -- node_modules, dist,
#         plugins/*/skills. On a module-only repo the named cause is never the
#         real cause, and no value of .xp-gate-powershell-prune-dirs can fix it.
#
#         #547 (closed) had already targeted "no ps1/psm1 predicates" as a
#         defect, and gate-3.sh matches '\.ps(m)?1$'. So Gate 1 and Gate 3
#         disagreed about what a PowerShell file is; this suite pins the single
#         definition both must share.
# @covers AC-620-01 AC-620-02 AC-620-03

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PS_ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"

setup() {
  WORK="$BATS_TEST_TMPDIR/psm1"
  mkdir -p "$WORK/src"
  cd "$WORK" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath "$WORK/.git/hooks"

  # Declare the rule set so the settings guard does not fire for an unrelated
  # reason, and the test measures discovery rather than configuration.
  printf "@{ Severity = @('Error','Warning') }\n" > PSScriptAnalyzerSettings.psd1

  echo 1.0.0 > VERSION
  printf '# C\n## [1.0.0]\n- init\n' > CHANGELOG.md
  echo '# p' > README.md
  git add -A
  git commit --no-verify -q -m init
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

have_pwsh() {
  command -v pwsh >/dev/null 2>&1 || command -v powershell.exe >/dev/null 2>&1
}

have_pssa() {
  have_pwsh || return 1
  pwsh -NoProfile -NonInteractive -Command \
    'if (Get-Module -ListAvailable PSScriptAnalyzer) { exit 0 } else { exit 1 }' \
    >/dev/null 2>&1
}

# Call the adapter's discovery directly. Going through the whole pre-commit
# pipeline would make the assertion depend on every other gate's prerequisites.
list_discovered() {
  local audit_dir="$REPO_ROOT/githooks/adapters"
  if command -v cygpath >/dev/null 2>&1; then
    audit_dir=$(cygpath -u "$audit_dir")
  fi
  cat > "$WORK/_discover.sh" <<'DRIVER'
#!/usr/bin/env bash
set -uo pipefail
# The adapter expects the helpers its parent hook normally provides.
if [ -f "$ADAPTER_DIR/../hooks/lib/toolchain-path.sh" ]; then
  # shellcheck source=/dev/null
  source "$ADAPTER_DIR/../hooks/lib/toolchain-path.sh"
fi
if [ -f "$ADAPTER_DIR/../hooks/lib/native-path.sh" ]; then
  # shellcheck source=/dev/null
  source "$ADAPTER_DIR/../hooks/lib/native-path.sh"
fi
# shellcheck source=/dev/null
source "$ADAPTER_DIR/powershell.sh"
_find_powershell_files
DRIVER
  ( cd "$WORK" && ADAPTER_DIR="$audit_dir" bash "$WORK/_discover.sh" 2>/dev/null )
}

@test "AC-620-01: discovery returns .psm1 modules, not only .ps1 scripts" {
  printf 'function Get-Module1 { return 1 }\n' > src/Mod.psm1
  printf 'function Get-Script1 { return 2 }\n' > src/Script.ps1

  run list_discovered
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/Mod.psm1"* ]]
  [[ "$output" == *"src/Script.ps1"* ]]
}

@test "AC-620-02: a module-only tree is not reported as empty" {
  # The exact shape that produced "no PowerShell files found outside the pruned
  # directories": nothing but a module.
  printf 'function Get-Only { return 1 }\n' > src/Only.psm1

  run list_discovered
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  [[ "$output" == *"src/Only.psm1"* ]]
}

@test "AC-620-03: .ps1 and .psm1 agree about what a PowerShell file is" {
  # Structural guard against the two gates drifting apart again: Gate 3's
  # predicate must cover the same extensions the adapter now discovers.
  run grep -E '\\\.ps\(m\)\?1\$' "$REPO_ROOT/githooks/gate-3.sh"
  [ "$status" -eq 0 ]

  # And the adapter must not reintroduce a single-extension literal at the call
  # site that this issue fixed.
  run bash -c "grep -n \"_find_powershell_files '\\*\\\\.ps1'\" '$PS_ADAPTER' || true"
  [ -z "$output" ]
}

@test "AC-620-04: PSScriptAnalyzer actually blocks a violation inside a .psm1" {
  have_pssa || skip "PSScriptAnalyzer unavailable"

  # The end-to-end consequence: identical offending code in a module must be
  # able to block. Pre-fix this reported WARN/not-verified instead.
  #
  # Drive the adapter from THIS checkout rather than the global install: a
  # machine with a global hooksPath resolves ADAPTER_DIR to
  # ~/.config/xp-gate/adapters, so running pre-commit would grade a different
  # file than the one this suite is testing (the same trap #598's suite hit).
  printf 'function Bad { $unused = 1; Write-Host %s }\n' "'x'" > src/Mod.psm1
  echo 1.0.1 > VERSION
  printf '# C\n## [1.0.1]\n- add\n' > CHANGELOG.md
  git add -A

  local audit_dir="$REPO_ROOT/githooks/adapters"
  if command -v cygpath >/dev/null 2>&1; then
    audit_dir=$(cygpath -u "$audit_dir")
  fi
  cat > "$WORK/_analyze.sh" <<'DRIVER'
#!/usr/bin/env bash
set -uo pipefail
for lib in toolchain-path native-path; do
  if [ -f "$ADAPTER_DIR/../hooks/lib/$lib.sh" ]; then
    # shellcheck source=/dev/null
    source "$ADAPTER_DIR/../hooks/lib/$lib.sh"
  fi
done
# shellcheck source=/dev/null
source "$ADAPTER_DIR/powershell.sh"
run_static_analysis
DRIVER

  run bash -c "cd '$WORK' && ADAPTER_DIR='$audit_dir' bash '$WORK/_analyze.sh' 2>&1"
  [[ "$output" == *"PSAvoidUsingWriteHost"* || "$output" == *"PSUseDeclaredVarsMoreThanAssignments"* ]]
  [[ "$output" != *"no PowerShell files found outside the pruned directories"* ]]
}
