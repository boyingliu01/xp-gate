#!/usr/bin/env bats
# @test REQ-577
# @intent Discovery prunes a built-in list (#538) which grew to cover the artifact
#         directories xp-gate itself produces. It does not cover the directories
#         that AI coding agents and IDEs create:
#
#           .xp-gate/   xp-gate's own report/journal output
#           .vscode/    editor settings, and any .ps1 a user drops there
#           .idea/      JetBrains project files
#           .qoder/     the Qoder plugin's workspace
#
#         Those hold tool-generated scripts, not product code, and scanning them
#         puts noise into the same three denominators as everything else. Every
#         consuming repo would otherwise have to list them in its own
#         `.xp-gate-powershell-prune-dirs`.
#
#         Carried forward from the installed adapter copy, which had these four and
#         which the repo did not.
#
#         Anti-regression: adding entries must not REMOVE any existing one. `wrc-drill`
#         and the other #538 entries stay pinned by their own suite.
# @covers AC-577-01, AC-577-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo"
  cd "$WORK/repo" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

find_files() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    _find_powershell_files "*.ps1"
  ' _ "$ADAPTER"
}

@test "AC-577-01: AI/IDE directories are pruned" {
  mkdir -p src .xp-gate .vscode .idea .qoder
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "report"' > .xp-gate/report.ps1
  echo 'Write-Host "editor"' > .vscode/settings.ps1
  echo 'Write-Host "jb"' > .idea/project.ps1
  echo 'Write-Host "qoder"' > .qoder/workspace.ps1

  run find_files
  [ -n "$output" ]
  [[ "$output" == *"src/product.ps1"* ]] || {
    echo "product code disappeared; got: $output"
    return 1
  }
  for artefact in report settings project workspace; do
    [[ "$output" != *"$artefact.ps1"* ]] || {
      echo "an AI/IDE artefact was discovered: $artefact.ps1; got: $output"
      return 1
    }
  done
}

@test "AC-577-02: the pre-existing #538 entries are still pruned" {
  # Adding entries must not be a rewrite: this re-asserts three of the original
  # ones in the same breath as AC-577-01, so a future edit that swaps the list
  # fails here rather than silently regressing #538.
  mkdir -p src wrc-drill .delphi-work node_modules/x
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "drill"' > wrc-drill/drill.ps1
  echo 'Write-Host "review"' > .delphi-work/copy.ps1
  echo 'Write-Host "dep"' > node_modules/x/dep.ps1

  run find_files
  [[ "$output" == *"src/product.ps1"* ]]
  [[ "$output" != *"drill.ps1"* ]]
  [[ "$output" != *"copy.ps1"* ]]
  [[ "$output" != *"dep.ps1"* ]]
}
