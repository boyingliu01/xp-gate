#!/usr/bin/env bats
# @test REQ-573
# @intent `_find_powershell_files` prunes a HARDCODED directory list (#538).
#         That list covers the artifact directories xp-gate itself and its
#         scaffolds produce, but a consuming repo can have its own: a generated
#         `obj/`, a vendored `third_party/`, a `samples/` tree of intentionally
#         broken scripts. Those repos have no way to exclude them, so their
#         Gate 1 stays an unusable warning wall — the exact failure #538 fixed
#         for xp-gate's own layout.
#
#         The unmerged branch `fix/powershell-gates-fail-closed` added a
#         repo-local `.xp-gate-powershell-prune-dirs` (one dir per line, `#`
#         comments) for this. This carries it forward, but NOT the branch's
#         replacement list: the branch dropped `wrc-drill` (which #538 pinned for
#         xp-gate's own drills) and added `.qoder`/`.vscode`/`.idea`/`.xp-gate`
#         that main never had. Adding the file reader ON TOP of main's existing
#         list keeps both behaviours; swapping the list in would regress #538.
#
#         Also verified: entries are matched by NAME, so a listed dir is pruned
#         at any depth (that is what `-name` does and what the branch relies on).
# @covers AC-573-01, AC-573-02, AC-573-03

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

# Source the adapter and call _find_powershell_files, printing the result.
find_files() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    _find_powershell_files "*.ps1"
  ' _ "$ADAPTER"
}

@test "AC-573-01: a directory listed in the prune file is excluded from discovery" {
  mkdir -p src generated/deep
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "generated"' > generated/deep/artefact.ps1

  printf 'generated\n' > .xp-gate-powershell-prune-dirs

  run find_files
  [ -n "$output" ]
  [[ "$output" == *"src/product.ps1"* ]]
  [[ "$output" != *"artefact.ps1"* ]] || {
    echo "a listed prune dir was still discovered; got: $output"
    return 1
  }
}

@test "AC-573-02: comments and blank lines in the prune file are ignored" {
  # A parsed-but-unusable entry would be passed to find as `-name ""`, which
  # either matches nothing (silently useless) or errors. Comments must be
  # skipped, not treated as directory names.
  mkdir -p src
  echo 'Write-Host "product"' > src/product.ps1

  printf '# generated artifacts\n\n   \n' > .xp-gate-powershell-prune-dirs

  run find_files
  [ -n "$output" ]
  [[ "$output" == *"src/product.ps1"* ]] || {
    echo "a comments-only prune file broke discovery; got: $output"
    return 1
  }
}

@test "AC-573-03: the built-in #538 prune list still works (no regression)" {
  # Anti-regression for the carry-over: the file reader must ADD to the
  # hardcoded list, not replace it. `wrc-drill` is pinned by #538 for xp-gate's
  # own admin drills and the branch's list dropped it.
  mkdir -p src wrc-drill node_modules/pkg .delphi-work
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "drill"' > wrc-drill/drill.ps1
  echo 'Write-Host "vendored"' > node_modules/pkg/dep.ps1
  echo 'Write-Host "review"' > .delphi-work/copy.ps1

  # No prune file at all: the built-in behaviour must be unchanged.
  [ ! -f .xp-gate-powershell-prune-dirs ]

  run find_files
  [ -n "$output" ]
  [[ "$output" == *"src/product.ps1"* ]]
  [[ "$output" != *"drill.ps1"* ]] || {
    echo "#538 regression: wrc-drill was not pruned; got: $output"
    return 1
  }
  [[ "$output" != *"dep.ps1"* ]]
  [[ "$output" != *"copy.ps1"* ]]
}
