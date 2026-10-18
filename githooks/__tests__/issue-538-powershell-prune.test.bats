#!/usr/bin/env bats
# @test REQ-538
# @intent _find_powershell_files only pruned .git/node_modules/dist/coverage and
#         the plugin skill mirrors, so gitignored drill/review artifacts
#         (wrc-drill/, .delphi-work/, .workbuddy/, .sprint-state/) were
#         collected as product sources: 800+ ScriptAnalyzer warnings from
#         non-product files made Gate 1 unusable whenever pwsh was on PATH.
#         Prune lists must cover drill/artifact dirs, and the analyzer scope
#         must not depend on find's pruning being complete.
# @covers AC-538-01, AC-538-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "#538 prune list covers drill and review artifact directories" {
  for dir in .worktrees .delphi-work .workbuddy .sprint-state wrc-drill; do
    grep -E -- "-name '?$dir'? ?-o|-name $dir" "$ADAPTER" >/dev/null \
      || { echo "missing prune entry: $dir"; return 1; }
  done
}

@test "#538 discovery excludes drill artifacts but keeps product scripts" {
  mkdir -p "$TEST_DIR/repo/wrc-drill" "$TEST_DIR/repo/.delphi-work" "$TEST_DIR/repo/src"
  echo 'Write-Host drill' > "$TEST_DIR/repo/wrc-drill/admin.ps1"
  echo 'Write-Host review' > "$TEST_DIR/repo/.delphi-work/review.Tests.ps1"
  echo 'function Get-Thing { 1 }' > "$TEST_DIR/repo/src/product.ps1"
  cd "$TEST_DIR/repo" || return 1
  # shellcheck disable=SC1091
  source "$ADAPTER"
  run _find_powershell_files "*.ps1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"./src/product.ps1"* ]]
  [[ "$output" != *"wrc-drill"* ]]
  [[ "$output" != *".delphi-work"* ]]
}
